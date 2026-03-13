import {randomUUID} from 'node:crypto';
import type {BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
  ResumePayload,
  ToolErrorHandler,
} from '@core/agents';
import {
  createAgent,
  normalizeAgentInput,
} from '@core/agents';
import type {AgentCheckpointer, CompactOptions} from '@core/checkpoint';
import {createAgentMemoryCheckpointer, putForkCheckpoint, putManualCheckpoint} from '@core/checkpoint';
import type {BaseMiddleware} from '@core/middleware';
import {
  compactConversationWithSummary,
  createModelSummaryGenerator,
  createSummaryMiddleware,
  resolveSummaryOptions,
  type SummaryOptions,
  type SummarySettings,
} from '@core/middleware/summary';
import type {GuidelinesSource} from '@core/instructions/guidelines';
import {type PromptSource} from '@core/instructions/prompt';
import {type SkillsSource} from '@core/skills';
import {buildBaseSystemMessage} from '@core/instructions/system-message';
import type {ModelInfo} from '@core/provider';
import {
  createSessionMetadata,
  deriveSessionInputBudget,
  forkSessionMetadata,
  syncSessionMetadata,
} from '@core/shared/session-metadata';
import type {SessionStore} from './store';

export type SessionStatus = 'ready' | 'closed';

export interface SessionMetadata {
  title?: string;
  lastMessage?: string;
  messageCount: number;
  tags?: string[];
  archived?: boolean;
  lastActivity: string;
  usage?: {
    modelCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastPromptTokens?: number;
    lastCompletionTokens?: number;
    lastTotalTokens?: number;
  };
  contextWindow?: {
    maxInputTokens: number;
    availableInputTokens: number;
    estimatedInputTokens: number;
    usagePercent: number;
    overBudget: boolean;
  };
  forkedFromSessionId?: string;
}

export interface SessionState {
  sessionId: string;
  sessionStatus: SessionStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: SessionMetadata;
}

export interface SessionModelCatalog {
  create(modelRef?: string): Promise<BaseChatModel>;
  getInfo(modelRef?: string): ModelInfo;
}

export interface CreateSessionOptions {
  state?: SessionState;
  id?: string;
  sessionId?: string;
  modelRef?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  modelCatalog?: SessionModelCatalog | Promise<SessionModelCatalog>;
  guidelinesSource?: GuidelinesSource;
  promptSource?: PromptSource;
  skillsSource?: SkillsSource;
  store?: SessionStore;
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: BaseMiddleware[];
  checkpointer?: AgentCheckpointer;
  summary?: false | SummarySettings;
  restore?: 'latest' | 'never';
  inputBudget?: AgentInputBudget;
  messages?: AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  metadata?: Partial<SessionMetadata>;
}

export interface Session {
  getState(): SessionState;
  getAgentState(): AgentState;
  hydrate(): Promise<AgentState>;
  compactConversation(options?: {instructions?: string}): Promise<AgentState>;
  fork(options?: {id?: string; sessionId?: string; store?: SessionStore}): Promise<Session>;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumePauseStream(
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  reloadSources(): Promise<void>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

interface SessionSystemContext {
  systemMessage: string[];
  runtimeShared?: Record<string, unknown>;
}

export function createSession(options: CreateSessionOptions): Session {
  const restored = options.state;
  const sessionId = resolveSessionId(restored, {
    id: options.id,
    sessionId: options.sessionId,
  });
  const createdAt = restored?.createdAt ?? new Date().toISOString();
  let updatedAt = restored?.updatedAt ?? createdAt;
  let sessionStatus: SessionStatus = 'ready';
  const metadata = createSessionMetadata(createdAt, restored?.metadata, options.metadata);
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const restoreCheckpoint = options.restore !== 'never';
  let inputBudget = options.inputBudget;
  let agent: Agent | undefined;
  let agentPromise: Promise<Agent> | undefined;
  let systemContext: SessionSystemContext | undefined;
  let summaryOptions: Required<SummaryOptions> | undefined;

  function state(): SessionState {
    return {sessionId, sessionStatus, createdAt, updatedAt, metadata};
  }

  function touch() {
    updatedAt = new Date().toISOString();
    metadata.lastActivity = updatedAt;
  }

  function clearAgentCache() {
    agent = undefined;
    agentPromise = undefined;
    summaryOptions = undefined;
  }

  async function persistSessionState(touchActivity = true) {
    if (touchActivity) {
      touch();
    }
    if (options.store) {
      await options.store.save(sessionId, state());
    }
  }

  async function getLatestCheckpoint() {
    return checkpointer.getLatest(sessionId);
  }

  async function hasStoredCheckpoint() {
    return Boolean(await getLatestCheckpoint());
  }

  async function sync(
    next: AgentState,
    syncOptions: {touchActivity?: boolean; collectUsage?: boolean; previousMessages?: readonly BaseMessage[]} = {},
  ) {
    if (syncOptions.touchActivity !== false) {
      touch();
    }

    syncSessionMetadata(metadata, next, {
      inputBudget,
      collectUsage: syncOptions.collectUsage,
      previousMessages: syncOptions.previousMessages,
    });
    if (options.store) {
      await options.store.save(sessionId, state());
    }
  }

  async function loadSessionSystemContext(forceReload = false): Promise<SessionSystemContext> {
    if (!forceReload && systemContext) {
      return systemContext;
    }

    if (forceReload) {
      systemContext = undefined;
      options.skillsSource?.reload();
    }

    systemContext = await buildSessionSystemContext(options.promptSource, options.guidelinesSource, options.skillsSource);
    return systemContext;
  }

  function requireAgent(): Agent {
    if (!agent) {
      throw new Error('Agent not initialized. Call invoke/stream first.');
    }
    return agent;
  }

  async function getAgent(): Promise<Agent> {
    if (agent) {
      return agent;
    }
    if (!agentPromise) {
      agentPromise = bootstrapSessionAgent().then((instance) => {
        agent = instance;
        return instance;
      }).finally(() => {
        if (!agent) {
          clearAgentCache();
        }
      });
    }
    return agentPromise;
  }

  async function bootstrapSessionAgent(): Promise<Agent> {
    const systemContext = await loadSessionSystemContext();
    const modelSelection = await resolveSessionModel(options);
    const checkpoint = restoreCheckpoint ? await getLatestCheckpoint() : undefined;

    inputBudget = options.inputBudget ?? deriveSessionInputBudget(modelSelection.modelInfo);
    summaryOptions = options.summary
      ? resolveSummaryOptions(options.summary, createModelSummaryGenerator(modelSelection.model))
      : undefined;

    return createAgent({
      model: modelSelection.model,
      tools: options.tools,
      handleToolErrors: options.handleToolErrors,
      middleware: buildSessionMiddleware(summaryOptions),
      checkpointer,
      sessionId,
      inputBudget,
      ...(checkpoint ? {checkpoint} : {}),
      ...(options.messages ? {messages: normalizeAgentInput(options.messages)} : {}),
      ...(options.context ? {context: options.context} : {}),
      ...(options.values ? {values: options.values} : {}),
      ...(systemContext.systemMessage.length > 0 ? {systemMessage: systemContext.systemMessage} : {}),
      ...(systemContext.runtimeShared ? {runtimeShared: systemContext.runtimeShared} : {}),
    });
  }

  function buildSessionMiddleware(summary: Required<SummaryOptions> | undefined): BaseMiddleware[] | undefined {
    const middlewares = [...(options.middleware ?? [])];
    if (!summary || middlewares.some((middleware) => middleware.name === 'SummaryMiddleware')) {
      return middlewares.length > 0 ? middlewares : undefined;
    }

    const summaryMiddleware = createSummaryMiddleware({summary});
    if (!summaryMiddleware) {
      return middlewares.length > 0 ? middlewares : undefined;
    }

    const hilIndex = middlewares.findIndex((middleware) => middleware.name === 'HumanInTheLoopMiddleware');
    if (hilIndex < 0) {
      middlewares.push(summaryMiddleware);
      return middlewares;
    }

    middlewares.splice(hilIndex, 0, summaryMiddleware);
    return middlewares;
  }

  function ensureReady() {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  async function run(operation: (instance: Agent) => Promise<AgentResult>) {
    const instance = await getAgent();
    const previousMessages = instance.getState().messages;
    const result = await operation(instance);
    await sync(result.state, {collectUsage: true, previousMessages});
    return result;
  }

  async function* runStream(operation: (instance: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>) {
    const instance = await getAgent();
    const previousMessages = instance.getState().messages;
    const result = yield* operation(instance);
    await sync(result.state, {collectUsage: true, previousMessages});
    return result;
  }

  async function fork(optionsOverride: {id?: string; sessionId?: string; store?: SessionStore} = {}) {
    const base = (await getAgent()).getState();
    const childSessionId = resolveSessionId(undefined, {
      id: optionsOverride.id,
      sessionId: optionsOverride.sessionId,
    });
    await putForkCheckpoint(checkpointer, childSessionId, {
      agentType: base.agentType,
      messages: base.messages,
      context: base.context,
      values: base.values,
      ...(base.pendingPause ? {pendingPause: base.pendingPause} : {}),
    });

    const child = createSession({
      ...options,
      id: childSessionId,
      sessionId: childSessionId,
      store: optionsOverride.store ?? options.store,
      restore: 'latest',
      metadata: forkSessionMetadata(metadata, sessionId),
    });
    await child.hydrate();
    return child;
  }

  async function compactConversation(compactOptions: {instructions?: string} = {}) {
    ensureReady();
    if (!options.summary) {
      throw new Error('Conversation compaction is not configured for this session.');
    }

    const instance = await getAgent();
    const summary = summaryOptions;

    if (!summary) {
      throw new Error('Conversation compaction is not configured for this session.');
    }

    const current = instance.getState();
    if (current.status === 'running') {
      throw new Error('Agent is currently running.');
    }
    if (current.status === 'paused') {
      throw new Error('Agent is paused; resume(...) or reset() before compacting the conversation.');
    }

    const systemContext = await loadSessionSystemContext();
    const compacted = await compactConversationWithSummary({
      messages: current.messages,
      context: current.context,
      values: current.values,
      systemMessage: systemContext.systemMessage,
      runtimeShared: systemContext.runtimeShared,
      sessionId,
      requestId: `${sessionId}:compact:${randomUUID()}`,
      inputBudget,
      instructions: compactOptions.instructions,
    }, summary);

    if (!compacted) {
      await sync(current);
      return current;
    }

    await putManualCheckpoint(checkpointer, sessionId, {
      agentType: current.agentType,
      messages: compacted.messages,
      context: compacted.context,
      values: compacted.values,
    }, await getLatestCheckpoint());

    clearAgentCache();
    const next = (await getAgent()).getState();
    await sync(next);
    return next;
  }

  return {
    getState: state,
    getAgentState() {
      return requireAgent().getState();
    },
    async hydrate() {
      ensureReady();
      const next = (await getAgent()).getState();
      await sync(next, {touchActivity: false});
      return next;
    },
    compactConversation,
    async fork(forkOptions = {}) {
      ensureReady();
      return fork(forkOptions);
    },
    async invoke(input, config) {
      ensureReady();
      return run((instance) => instance.invoke(input, config));
    },
    async *stream(input, config) {
      ensureReady();
      return yield* runStream((instance) => instance.stream(input, config));
    },
    async resumePause(payload, config) {
      ensureReady();
      return run((instance) => instance.resume(payload, config));
    },
    async *resumePauseStream(payload, config) {
      ensureReady();
      return yield* runStream((instance) => instance.resumeStream(payload, config));
    },
    async reloadSources() {
      ensureReady();
      await loadSessionSystemContext(true);
      clearAgentCache();
      await persistSessionState();
    },
    async compactCheckpoints(optionsOverride) {
      ensureReady();
      if (!checkpointer.compact) {
        return;
      }
      await checkpointer.compact(sessionId, optionsOverride);
      await persistSessionState();
    },
    async reset() {
      ensureReady();
      if (!agent && !(await hasStoredCheckpoint())) {
        await persistSessionState();
        return;
      }
      const instance = await getAgent();
      await instance.reset();
      await sync(instance.getState());
    },
    async dispose() {
      if (sessionStatus === 'closed') {
        return;
      }
      if (!agent && !(await hasStoredCheckpoint())) {
        sessionStatus = 'closed';
        await persistSessionState();
        return;
      }
      await (await getAgent()).dispose();
      sessionStatus = 'closed';
      await persistSessionState();
    },
  };
}

function resolveSessionId(
  restored: SessionState | undefined,
  input: {
    id?: string;
    sessionId?: string;
  } = {},
): string {
  const restoredSessionId = restored?.sessionId?.trim();
  return restoredSessionId || input.id || input.sessionId || randomUUID();
}

async function buildSessionSystemContext(
  promptSource?: PromptSource,
  guidelinesSource?: GuidelinesSource,
  skillsSource?: SkillsSource,
): Promise<SessionSystemContext> {
  return buildBaseSystemMessage(promptSource, guidelinesSource, skillsSource);
}

async function resolveSessionModel(
  options: CreateSessionOptions,
): Promise<{model: BaseChatModel; modelInfo?: ModelInfo}> {
  if (options.model) {
    return {model: await options.model};
  }

  if (!options.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await options.modelCatalog;
  const modelRef = options.modelRef ?? 'default';
  return {model: await catalog.create(modelRef), modelInfo: catalog.getInfo(modelRef)};
}

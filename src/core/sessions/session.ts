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
  hasEquivalentCheckpointState,
  cloneAgentContext,
  cloneAgentMessages,
  cloneAgentValues,
  clonePauseRequest,
  createAgent,
  normalizeAgentInput,
} from '@core/agents';
import type {AgentCheckpointer, CompactOptions} from '@core/checkpoint';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import type {BaseMiddleware, BeforeModelContext} from '@core/middleware';
import {
  compactSummaryIfNeeded,
  createModelSummaryGenerator,
  createSummaryMiddleware,
  resolveSummaryOptions,
  type SummaryOptions,
  type SummarySettings,
} from '@core/middleware/summary';
import type {GuidelinesSource} from '@core/instructions/guidelines';
import {
  formatSkillsList,
  formatSkillsLocations,
  SKILLS_SYSTEM_PROMPT,
  type SkillsRuntimeData,
  type SkillsSource,
} from '@core/instructions/skills';
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
  forkedFromThreadId?: string;
}

export interface SessionState {
  sessionId: string;
  threadId: string;
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
  sessionId?: string;
  threadId?: string;
  modelRef?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  modelCatalog?: SessionModelCatalog | Promise<SessionModelCatalog>;
  guidelinesSource?: GuidelinesSource;
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
  fork(options?: {sessionId?: string; threadId?: string; store?: SessionStore}): Promise<Session>;
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
  runtimeShared?: {
    skills: SkillsRuntimeData;
  };
}

export function createSession(options: CreateSessionOptions): Session {
  const restored = options.state;
  const sessionId = restored?.sessionId ?? options.sessionId ?? randomUUID();
  const threadId = restored?.threadId ?? options.threadId ?? randomUUID();
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
    return {sessionId, threadId, sessionStatus, createdAt, updatedAt, metadata};
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

  async function save() {
    if (options.store) {
      await options.store.save(sessionId, state());
    }
  }

  async function saveSessionState(touchActivity = true) {
    if (touchActivity) {
      touch();
    }
    await save();
  }

  async function getLatestCheckpoint() {
    return checkpointer.getLatest(threadId);
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
    await save();
  }

  async function loadSessionSystemContext(forceReload = false): Promise<SessionSystemContext> {
    if (!forceReload && systemContext) {
      return systemContext;
    }

    if (forceReload) {
      systemContext = undefined;
      options.skillsSource?.reload();
    }

    const guidelinesMessage = await options.guidelinesSource?.getContent?.();
    const skillsRuntime = await options.skillsSource?.getRuntime?.();
    systemContext = {
      systemMessage: [guidelinesMessage, skillsRuntime ? createSkillsSystemMessage(skillsRuntime) : undefined]
        .filter((value): value is string => Boolean(value)),
      ...(skillsRuntime ? {runtimeShared: {skills: skillsRuntime}} : {}),
    };
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
    const modelSelection = await (async (): Promise<{model: BaseChatModel; modelInfo?: ModelInfo}> => {
      if (options.model) {
        return {model: await options.model};
      }

      if (!options.modelCatalog) {
        throw new Error('Either model or modelCatalog must be provided');
      }

      const catalog = await options.modelCatalog;
      const modelRef = options.modelRef ?? 'default';
      return {model: await catalog.create(modelRef), modelInfo: catalog.getInfo(modelRef)};
    })();
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
      threadId,
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

  async function fork(optionsOverride: {sessionId?: string; threadId?: string; store?: SessionStore} = {}) {
    const base = (await getAgent()).getState();
    const childThreadId = optionsOverride.threadId ?? randomUUID();

    await checkpointer.put({
      threadId: childThreadId,
      state: {
        agentType: base.agentType,
        messages: cloneAgentMessages(base.messages),
        context: cloneAgentContext(base.context),
        values: cloneAgentValues(base.values),
        ...(base.pendingPause ? {pendingPause: clonePauseRequest(base.pendingPause)} : {}),
      },
      info: {
        source: 'fork',
        status: base.pendingPause ? 'paused' : 'idle',
        step: 0,
        createdAt: new Date().toISOString(),
      },
    });

    const child = createSession({
      ...options,
      sessionId: optionsOverride.sessionId,
      threadId: childThreadId,
      store: optionsOverride.store ?? options.store,
      restore: 'latest',
      metadata: forkSessionMetadata(metadata, sessionId, threadId),
    });
    await child.hydrate();
    return child;
  }

  async function persistCompactedConversation(
    current: AgentState,
    messages: BaseMessage[],
    context: Record<string, unknown>,
    values: Record<string, unknown>,
  ) {
    const latest = await getLatestCheckpoint();
    await checkpointer.put({
      threadId,
      ...(latest?.ref.checkpointId ? {parentCheckpointId: latest.ref.checkpointId} : {}),
      state: {
        agentType: current.agentType,
        messages: cloneAgentMessages(messages),
        context: cloneAgentContext(context),
        values: cloneAgentValues(values),
      },
      info: {
        source: 'manual',
        status: 'idle',
        reason: 'complete',
        turns: 0,
        step: (latest?.info.step ?? 0) + 1,
        createdAt: new Date().toISOString(),
      },
    });
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
    const before = {
      agentType: current.agentType,
      messages: current.messages,
      context: current.context,
      values: current.values,
      pendingPause: current.pendingPause,
    };
    const nextMessages = cloneAgentMessages(current.messages);
    const nextContext = cloneAgentContext(current.context);
    const nextValues = cloneAgentValues(current.values);
    const context: BeforeModelContext = {
      state: {
        messages: nextMessages,
        context: nextContext,
        values: nextValues,
      },
      messages: nextMessages,
      runtime: {
        context: nextContext,
        runtimeContext: {},
        ...(systemContext.runtimeShared ? {shared: systemContext.runtimeShared} : {}),
      },
      systemMessage: [...systemContext.systemMessage],
      execution: {
        threadId,
        runId: randomUUID(),
        turn: 1,
        maxTurns: 1,
        requestId: `${sessionId}:compact`,
      },
      inputBudget,
    };

    const changed = await compactSummaryIfNeeded(context, summary, {
      force: true,
      instructions: compactOptions.instructions,
    });

    const after = {
      agentType: current.agentType,
      messages: context.state.messages,
      context: nextContext,
      values: nextValues,
      pendingPause: current.pendingPause,
    };

    if (!changed || hasEquivalentCheckpointState(before, after)) {
      await sync(current);
      return current;
    }

    await persistCompactedConversation(current, context.state.messages, nextContext, nextValues);

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
      await saveSessionState();
    },
    async compactCheckpoints(optionsOverride) {
      ensureReady();
      if (!checkpointer.compact) {
        return;
      }
      await checkpointer.compact(threadId, optionsOverride);
      await saveSessionState();
    },
    async reset() {
      ensureReady();
      if (!agent && !(await hasStoredCheckpoint())) {
        await saveSessionState();
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
        await saveSessionState();
        return;
      }
      await (await getAgent()).dispose();
      sessionStatus = 'closed';
      await saveSessionState();
    },
  };
}

function createSkillsSystemMessage(runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}

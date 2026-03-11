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
  cloneAgentContext,
  cloneAgentMessages,
  cloneAgentValues,
  clonePauseRequest,
  createAgent,
  normalizeAgentInput,
} from '@core/agents';
import type {AgentCheckpointer, CompactOptions} from '@core/checkpoint';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import type {BaseMiddleware} from '@core/middleware';
import {normalizeSummaryOptions, type SummaryOptions} from '@core/middleware/conversation';
import type {AgentsFileOverview, AgentsFileScope, GuidelinesSource} from '@core/instructions/guidelines';
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
  summary?: false | SummaryOptions;
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
  inspectAgentsFiles(): Promise<AgentsFileOverview>;
  ensureAgentsFileTarget(scope: AgentsFileScope): Promise<string>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
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
  const restoreCheckpoint = options.restore === 'latest' || (options.restore !== 'never' && options.threadId !== undefined);
  let inputBudget = options.inputBudget;
  let agent: Agent | undefined;
  let agentPromise: Promise<Agent> | undefined;
  let guidelinesMessage: string | undefined;
  let skillsRuntime: SkillsRuntimeData | undefined;
  let skillsMessage: string | undefined;

  function state(): SessionState {
    return {sessionId, threadId, sessionStatus, createdAt, updatedAt, metadata};
  }

  function touch() {
    updatedAt = new Date().toISOString();
    metadata.lastActivity = updatedAt;
  }

  async function save() {
    if (options.store) {
      await options.store.save(sessionId, state());
    }
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

  async function loadSources(forceReload = false) {
    if (forceReload) {
      options.guidelinesSource?.reload();
      options.skillsSource?.reload();
      guidelinesMessage = undefined;
      skillsRuntime = undefined;
      skillsMessage = undefined;
    }

    guidelinesMessage = await options.guidelinesSource?.getContent?.();
    skillsRuntime = await options.skillsSource?.getRuntime?.();
    skillsMessage = skillsRuntime ? createSkillsSystemMessage(skillsRuntime) : undefined;
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
      agentPromise = initializeAgent().then((instance) => {
        agent = instance;
        return instance;
      }).finally(() => {
        if (!agent) {
          agentPromise = undefined;
        }
      });
    }
    return agentPromise;
  }

  async function initializeAgent(): Promise<Agent> {
    await loadSources();
    const selection = await resolveModel();
    const checkpoint = restoreCheckpoint ? await checkpointer.getLatest(threadId) : undefined;
    inputBudget = options.inputBudget ?? deriveSessionInputBudget(selection.modelInfo);
    const systemMessage = [guidelinesMessage, skillsMessage].filter((value): value is string => Boolean(value));

    return createAgent({
      model: selection.model,
      tools: options.tools,
      handleToolErrors: options.handleToolErrors,
      middleware: options.middleware,
      checkpointer,
      threadId,
      inputBudget,
      ...(options.summary ? {summary: normalizeSummaryOptions(options.summary)} : {}),
      ...(checkpoint ? {checkpoint} : {}),
      ...(options.messages ? {messages: normalizeAgentInput(options.messages)} : {}),
      ...(options.context ? {context: options.context} : {}),
      ...(options.values ? {values: options.values} : {}),
      ...(systemMessage.length > 0 ? {systemMessage} : {}),
      ...(skillsRuntime ? {runtimeShared: {skills: skillsRuntime}} : {}),
    });
  }

  async function resolveModel(): Promise<{model: BaseChatModel; modelInfo?: ModelInfo}> {
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

  function requireGuidelinesActions() {
    const source = options.guidelinesSource;
    if (!source?.inspectFiles || !source.ensureFileTarget) {
      throw new Error('AGENTS file actions are not available for this session.');
    }
    return source;
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
    async compactConversation(compactOptions = {}) {
      ensureReady();
      const next = await (await getAgent()).compactConversation(compactOptions);
      await sync(next);
      return next;
    },
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
      await loadSources(true);
      agent = undefined;
      agentPromise = undefined;
      touch();
      await save();
    },
    async inspectAgentsFiles() {
      ensureReady();
      return requireGuidelinesActions().inspectFiles!();
    },
    async ensureAgentsFileTarget(scope) {
      ensureReady();
      return requireGuidelinesActions().ensureFileTarget!(scope);
    },
    async compactCheckpoints(optionsOverride) {
      ensureReady();
      if (!checkpointer.compact) {
        return;
      }
      await checkpointer.compact(threadId, optionsOverride);
      touch();
      await save();
    },
    async reset() {
      ensureReady();
      if (!agent && !(await checkpointer.getLatest(threadId))) {
        touch();
        await save();
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
      if (!agent && !(await checkpointer.getLatest(threadId))) {
        sessionStatus = 'closed';
        touch();
        await save();
        return;
      }
      await (await getAgent()).dispose();
      sessionStatus = 'closed';
      touch();
      await save();
    },
  };
}

function createSkillsSystemMessage(runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}

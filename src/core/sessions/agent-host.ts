import {randomUUID} from 'node:crypto';
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
} from '@core/agents';
import {createAgent, normalizeAgentInput} from '@core/agents';
import {deriveAgentInputBudget} from '@core/agents/input-budget';
import {
  cloneAgentContext,
  cloneAgentMessages,
  clonePauseRequest,
  cloneAgentValues,
} from '@core/agents/engine/state';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {ModelInfo} from '@core/provider';
import type {CreateSessionOptions} from '@core/sessions/types';
import type {ResumePayload} from '@core/agents/contract/pause';

export interface SessionAgentHostSyncOptions {
  touchActivity?: boolean;
  applyTelemetry?: boolean;
  previousState?: Pick<AgentState, 'messages'>;
}

export interface SessionAgentHost {
  getAgent(): Promise<Agent>;
  requireInitializedAgent(): Agent;
  hydrate(): Promise<AgentState>;
  compactConversation(options?: {instructions?: string}): Promise<AgentState>;
  fork(options?: {
    sessionId?: string;
    threadId?: string;
    store?: CreateSessionOptions['store'];
  }): Promise<import('@core/sessions/types').Session>;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumePauseStream(
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  reset(): Promise<AgentState | undefined>;
  dispose(): Promise<void>;
}

export interface CreateSessionAgentHostOptions {
  sessionOptions: CreateSessionOptions;
  threadId: string;
  isRestoringThread: boolean;
  checkpointer: NonNullable<CreateSessionOptions['checkpointer']>;
  sessionId: string;
  createSession(sessionOptions: CreateSessionOptions): import('@core/sessions/types').Session;
  syncSessionFromState(
    agentState: AgentState,
    options?: SessionAgentHostSyncOptions,
  ): Promise<void>;
  cloneMetadata(): Partial<import('@core/sessions/types').SessionMetadata>;
  cloneForkMetadata(): Partial<import('@core/sessions/types').SessionMetadata>;
  prepareHostSources(): Promise<void>;
}

export function createSessionAgentHost(
  options: CreateSessionAgentHostOptions,
): SessionAgentHost {
  let agentInstance: Agent | undefined;
  let agentBootstrap: Promise<Agent> | undefined;

  async function getAgent(): Promise<Agent> {
    if (agentInstance) {
      return agentInstance;
    }

    if (agentBootstrap) {
      return agentBootstrap;
    }

    agentBootstrap = (async () => {
      await options.prepareHostSources();
      const selection = await resolveSessionModelSelection(options.sessionOptions);
      const shouldRestore = options.sessionOptions.restore === 'latest'
        || (options.sessionOptions.restore !== 'never' && options.isRestoringThread);
      const checkpoint = shouldRestore
        ? await options.checkpointer.getLatest(options.threadId)
        : undefined;
      const messages = options.sessionOptions.messages
        ? normalizeAgentInput(options.sessionOptions.messages)
        : undefined;

      agentInstance = createAgent({
        model: selection.model,
        tools: options.sessionOptions.tools,
        middleware: options.sessionOptions.middleware,
        checkpointer: options.checkpointer,
        threadId: options.threadId,
        inputBudget: resolveSessionInputBudget(options.sessionOptions, selection.modelInfo),
        ...(checkpoint ? {checkpoint} : {}),
        ...(messages ? {messages} : {}),
        ...(options.sessionOptions.context ? {context: options.sessionOptions.context} : {}),
        ...(options.sessionOptions.values ? {values: options.sessionOptions.values} : {}),
      });

      return agentInstance;
    })();

    try {
      return await agentBootstrap;
    } finally {
      if (agentInstance) {
        agentBootstrap = Promise.resolve(agentInstance);
      } else {
        agentBootstrap = undefined;
      }
    }
  }

  function requireInitializedAgent(): Agent {
    if (!agentInstance) {
      throw new Error('Agent not initialized. Call invoke/stream first.');
    }
    return agentInstance;
  }

  async function runAgentResult(
    operation: (agent: Agent) => Promise<AgentResult>,
  ): Promise<AgentResult> {
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = await operation(agent);
    await options.syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  async function* runAgentStreamResult(
    operation: (agent: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = yield* operation(agent);
    await options.syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  return {
    getAgent,
    requireInitializedAgent,

    async hydrate(): Promise<AgentState> {
      const state = (await getAgent()).getState();
      await options.syncSessionFromState(state, {touchActivity: false});
      return state;
    },

    async compactConversation(compactOptions = {}): Promise<AgentState> {
      const state = await (await getAgent()).compactConversation(compactOptions);
      await options.syncSessionFromState(state);
      return state;
    },

    async fork(forkOptions = {}): Promise<import('@core/sessions/types').Session> {
      const baseState = (await getAgent()).getState();
      const threadId = forkOptions.threadId ?? randomUUID();
      await options.checkpointer.put({
        threadId,
        state: {
          agentType: baseState.agentType,
          messages: cloneAgentMessages(baseState.messages),
          context: cloneAgentContext(baseState.context),
          values: cloneAgentValues(baseState.values),
          ...(baseState.pendingPause ? {pendingPause: clonePauseRequest(baseState.pendingPause)} : {}),
        },
        info: {
          source: 'fork',
          status: baseState.pendingPause ? 'paused' : 'idle',
          step: 0,
          createdAt: new Date().toISOString(),
        },
      });
      const child = options.createSession({
        ...options.sessionOptions,
        sessionId: forkOptions.sessionId,
        threadId,
        store: forkOptions.store ?? options.sessionOptions.store,
        restore: 'latest',
        metadata: {
          ...options.cloneForkMetadata(),
          forkedFromSessionId: options.sessionId,
          forkedFromThreadId: options.threadId,
        },
      });
      await child.hydrate();
      return child;
    },

    invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult> {
      return runAgentResult((agent) => agent.invoke(input, config));
    },

    stream(
      input?: AgentInput,
      config?: AgentStreamConfig,
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      return runAgentStreamResult((agent) => agent.stream(input, config));
    },

    resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult> {
      return runAgentResult((agent) => agent.resume(payload, config));
    },

    resumePauseStream(
      payload: ResumePayload,
      config?: AgentResumeStreamConfig,
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      return runAgentStreamResult((agent) => agent.resumeStream(payload, config));
    },

    async reset(): Promise<AgentState | undefined> {
      if (!agentInstance) {
        const checkpoint = await options.checkpointer.getLatest(options.threadId);
        if (!checkpoint) {
          return undefined;
        }
      }

      const agent = await getAgent();
      if (!agent) {
        return undefined;
      }

      await agent.reset();
      const state = agent.getState();
      await options.syncSessionFromState(state);
      return state;
    },

    async dispose(): Promise<void> {
      if (!agentInstance) {
        const checkpoint = await options.checkpointer.getLatest(options.threadId);
        if (!checkpoint) {
          return;
        }
      }

      await (await getAgent()).dispose();
    },
  };
}

async function resolveSessionModelSelection(options: CreateSessionOptions): Promise<{
  model: BaseChatModel;
  modelInfo?: ModelInfo;
}> {
  if (options.model) {
    return {
      model: await options.model,
    };
  }

  if (!options.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await options.modelCatalog;
  const modelRef = options.modelRef ?? 'default';
  return {
    model: await catalog.create(modelRef),
    modelInfo: catalog.getInfo(modelRef),
  };
}

function resolveSessionInputBudget(
  options: CreateSessionOptions,
  modelInfo?: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'>,
): AgentInputBudget | undefined {
  return options.inputBudget ?? deriveAgentInputBudget(modelInfo);
}

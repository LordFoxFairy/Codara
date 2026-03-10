import {randomUUID} from 'node:crypto';
import type {
  Agent,
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
} from '@core/agents';
import {createAgent} from '@core/agents';
import {cloneContext, cloneValues} from '@core/agents/engine/state';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {CompactOptions} from '@core/checkpoint/types';
import {normalizeAgentInput} from '@core/agents/engine/runtime-input';
import type {HILResumePayload} from '@core/middleware';
import type {CreateSessionOptions, Session, SessionState, SessionStatus, SessionMetadata} from '@core/sessions/types';
import {buildSessionTelemetryPatch, mergeSessionTelemetry} from '@core/sessions/telemetry';
import {
  cloneAgentMessages,
  createSessionMetadata,
  touchSessionMetadata,
  updateSessionMetadataFromAgentState,
} from '@core/sessions/metadata';
import {resolveSessionInputBudget, resolveSessionModelSelection} from '@core/sessions/model-selection';

/**
 * 创建 session 实例。
 * Session 负责：
 * - AGENTS source 生命周期持有与刷新
 * - agent 实例管理（lazy creation、checkpoint restore）
 * - 对外暴露 invoke/stream/resume 等方法
 */
export function createSession(options: CreateSessionOptions): Session {
  const restoredState = options.state;
  const sessionId = restoredState?.sessionId ?? options.sessionId ?? randomUUID();
  const threadId = restoredState?.threadId ?? options.threadId ?? randomUUID();
  const isRestoringThread = options.threadId !== undefined;
  const createdAt = restoredState?.createdAt ?? new Date().toISOString();
  let updatedAt = restoredState?.updatedAt ?? createdAt;
  let sessionStatus: SessionStatus = restoredState?.sessionStatus ?? 'ready';
  let agentInstance: Agent | undefined;
  let agentBootstrap: Promise<Agent> | undefined;
  const metadata: SessionMetadata = createSessionMetadata(
    createdAt,
    restoredState?.metadata,
    options.metadata,
  );
  const store = options.store;
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

  function touch(): void {
    updatedAt = new Date().toISOString();
    touchSessionMetadata(metadata, updatedAt);
  }

  async function saveSession(): Promise<void> {
    if (store) {
      await store.save(sessionId, {
        sessionId,
        threadId,
        sessionStatus,
        createdAt,
        updatedAt,
        metadata,
      });
    }
  }

  function updateMetadataFromState(agentState: AgentState): void {
    updateSessionMetadataFromAgentState(metadata, agentState);
  }

  async function syncSessionFromState(
    agentState: AgentState,
    options: {
      touchActivity?: boolean;
      applyTelemetry?: boolean;
      previousState?: Pick<AgentState, 'messages'>;
    } = {},
  ): Promise<void> {
    if (options.touchActivity !== false) {
      touch();
    }

    updateMetadataFromState(agentState);
    if (options.applyTelemetry) {
      mergeSessionTelemetry(metadata, buildSessionTelemetryPatch(agentState, options.previousState));
    }
    await saveSession();
  }

  async function getAgent(): Promise<Agent> {
    if (agentInstance) {
      return agentInstance;
    }

    if (agentBootstrap) {
      return agentBootstrap;
    }

    agentBootstrap = (async () => {
      // Lazy creation
      const selection = await resolveSessionModelSelection(options);

      // Auto-restore: threadId provided = restore latest checkpoint
      // Explicit restore option overrides this behavior
      const shouldRestore = options.restore === 'latest'
        || (options.restore !== 'never' && isRestoringThread);

      const checkpoint = shouldRestore
        ? await checkpointer.getLatest(threadId)
        : undefined;

      // Normalize messages input
      const messages = options.messages ? normalizeAgentInput(options.messages) : undefined;

      agentInstance = createAgent({
        model: selection.model,
        tools: options.tools,
        middleware: options.middleware,
        checkpointer,
        threadId,
        inputBudget: resolveSessionInputBudget(options, selection.modelInfo),
        ...(checkpoint ? {checkpoint} : {}),
        ...(messages ? {messages} : {}),
        ...(options.context ? {context: options.context} : {}),
        ...(options.values ? {values: options.values} : {}),
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

  function requireReady(): void {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
  }

  function buildSessionState(): SessionState {
    return {
      sessionId,
      threadId,
      sessionStatus,
      createdAt,
      updatedAt,
      metadata,
    };
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
    requireReady();
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = await operation(agent);
    await syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  async function* runAgentStreamResult(
    operation: (agent: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    requireReady();
    const agent = await getAgent();
    const previousState = agent.getState();
    const result = yield* operation(agent);
    await syncSessionFromState(result.state, {applyTelemetry: true, previousState});
    return result;
  }

  return {
    getState(): SessionState {
      return buildSessionState();
    },

    getAgentState(): AgentState {
      return requireInitializedAgent().getState();
    },

    async hydrate(): Promise<AgentState> {
      requireReady();
      const agent = await getAgent();
      const state = agent.getState();
      await syncSessionFromState(state);
      return state;
    },

    async compactConversation(compactOptions = {}): Promise<AgentState> {
      requireReady();
      const agent = await getAgent();
      const state = await agent.compactConversation(compactOptions);
      await syncSessionFromState(state);
      return state;
    },

    async fork(forkOptions = {}): Promise<Session> {
      requireReady();
      const agent = await getAgent();
      const baseState = agent.getState();
      const child = createSession({
        ...options,
        sessionId: forkOptions.sessionId,
        threadId: forkOptions.threadId,
        store: forkOptions.store ?? options.store,
        restore: 'never',
        messages: cloneAgentMessages(baseState.messages),
        context: cloneContext(baseState.context),
        values: cloneValues(baseState.values),
        metadata: {
          title: metadata.title,
          tags: metadata.tags ? [...metadata.tags] : undefined,
          forkedFromSessionId: sessionId,
          forkedFromThreadId: threadId,
        },
      });
      await child.hydrate();
      return child;
    },

    async invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult> {
      return runAgentResult((agent) => agent.invoke(input, config));
    },

    async *stream(
      input?: AgentInput,
      config?: AgentStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      return yield* runAgentStreamResult((agent) => agent.stream(input, config));
    },

    async resumePause(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult> {
      return runAgentResult((agent) => agent.resume(payload, config));
    },

    async *resumePauseStream(
      payload: HILResumePayload,
      config?: AgentResumeStreamConfig
    ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
      return yield* runAgentStreamResult((agent) => agent.resumeStream(payload, config));
    },

    async reloadSources(): Promise<void> {
      requireReady();
      touch();
      if (options.agentsSource) {
        options.agentsSource.reload();
      }
      await options.skillsStore?.refresh?.();
      await saveSession();
    },

    async inspectAgentsFiles() {
      if (!options.agentsSource?.inspectFiles) {
        throw new Error('AGENTS file actions are not available for this session.');
      }
      return options.agentsSource.inspectFiles();
    },

    async ensureAgentsFileTarget(scope) {
      if (!options.agentsSource?.ensureFileTarget) {
        throw new Error('AGENTS file actions are not available for this session.');
      }
      return options.agentsSource.ensureFileTarget(scope);
    },

    async compactCheckpoints(options?: CompactOptions): Promise<void> {
      requireReady();
      if (!checkpointer.compact) {
        return;
      }

      await checkpointer.compact(threadId, options);
      touch();
      await saveSession();
    },

    async reset(): Promise<void> {
      requireReady();
      if (agentInstance) {
        await agentInstance.reset();
        await syncSessionFromState(agentInstance.getState());
        return;
      }
      touch();
      await saveSession();
    },

    async dispose(): Promise<void> {
      if (sessionStatus === 'closed') {
        return;
      }
      if (agentInstance) {
        await agentInstance.dispose();
      }
      sessionStatus = 'closed';
      touch();
      await saveSession();
    },
  };
}

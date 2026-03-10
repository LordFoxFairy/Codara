import {randomUUID} from 'node:crypto';
import type {AgentState} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {CompactOptions} from '@core/checkpoint/types';
import type {CreateSessionOptions, Session, SessionState, SessionStatus, SessionMetadata} from '@core/sessions/types';
import {createSessionAgentHost} from '@core/sessions/agent-host';
import {
  buildSessionTelemetryPatch,
  cloneSessionMetadata,
  createSessionMetadata,
  mergeSessionTelemetry,
  touchSessionMetadata,
  updateSessionMetadataFromAgentState,
} from '@core/sessions/metadata';

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

  const agentHost = createSessionAgentHost({
    sessionOptions: options,
    threadId,
    isRestoringThread,
    checkpointer,
    sessionId,
    createSession,
    syncSessionFromState,
    cloneMetadata: () => cloneSessionMetadata(metadata),
  });

  return {
    getState(): SessionState {
      return buildSessionState();
    },

    getAgentState(): AgentState {
      return agentHost.requireInitializedAgent().getState();
    },

    async hydrate(): Promise<AgentState> {
      requireReady();
      return agentHost.hydrate();
    },

    async compactConversation(compactOptions = {}): Promise<AgentState> {
      requireReady();
      return agentHost.compactConversation(compactOptions);
    },

    async fork(forkOptions = {}): Promise<Session> {
      requireReady();
      return agentHost.fork(forkOptions);
    },

    async invoke(input, config) {
      requireReady();
      return agentHost.invoke(input, config);
    },

    async *stream(
      input,
      config,
    ) {
      requireReady();
      return yield* agentHost.stream(input, config);
    },

    async resumePause(payload, config) {
      requireReady();
      return agentHost.resumePause(payload, config);
    },

    async *resumePauseStream(payload, config) {
      requireReady();
      return yield* agentHost.resumePauseStream(payload, config);
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
      const nextState = await agentHost.reset();
      if (nextState) {
        return;
      }
      touch();
      await saveSession();
    },

    async dispose(): Promise<void> {
      if (sessionStatus === 'closed') {
        return;
      }
      await agentHost.dispose();
      sessionStatus = 'closed';
      touch();
      await saveSession();
    },
  };
}

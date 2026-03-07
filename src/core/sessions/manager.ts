import type {
  AgentInput,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentRunConfig,
} from '@core/agents/agent';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/stream';
import {createCodaraAgent, loadCodaraAgent} from '@core/agents/codara';
import type {AgentInstanceState} from '@core/checkpoint/state';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {HILResumePayload} from '@core/middleware';
import {createCodaraSession, type CodaraSession} from '@core/sessions/session';
import type {
  CreateCodaraOptions,
  CreateCodaraSessionOptions,
  LoadCodaraSessionOptions,
} from '@core/sessions/types';

type CodaraQueryResult = Awaited<ReturnType<CodaraSession['query']>>;
type CodaraResumeResult = Awaited<ReturnType<CodaraSession['resume']>>;

export interface Codara {
  session(): Promise<CodaraSession>;
  query(input?: AgentInput, config?: AgentRunConfig): Promise<CodaraQueryResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraQueryResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<CodaraResumeResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraResumeResult, void>;
  openSession(options?: CreateCodaraSessionOptions): Promise<CodaraSession>;
  createSession(options?: CreateCodaraSessionOptions): Promise<CodaraSession>;
  loadSession(options: LoadCodaraSessionOptions): Promise<CodaraSession | undefined>;
  getState(): Promise<AgentInstanceState>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export function createCodara(options: CreateCodaraOptions = {}): Codara {
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  let defaultSessionPromise: Promise<CodaraSession> | undefined;

  function getDefaultSession(): Promise<CodaraSession> {
    if (!defaultSessionPromise) {
      defaultSessionPromise = openSession({
        ...(options.threadId ? {threadId: options.threadId} : {}),
        ...(options.messages ? {messages: options.messages} : {}),
        ...(options.context ? {context: options.context} : {}),
      });
    }

    return defaultSessionPromise;
  }

  async function openSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<CodaraSession> {
    if (optionsOverride.threadId) {
      const restored = await loadCodaraAgent({
        ...options,
        ...optionsOverride,
        threadId: optionsOverride.threadId,
        checkpointer: optionsOverride.checkpointer ?? checkpointer,
      });

      if (restored) {
        return createCodaraSession(restored);
      }
    }

    return createSession(optionsOverride);
  }

  async function createSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<CodaraSession> {
    const agent = await createCodaraAgent({
      ...options,
      ...optionsOverride,
      checkpointer: optionsOverride.checkpointer ?? checkpointer,
    });
    return createCodaraSession(agent);
  }

  return {
    session() {
      return getDefaultSession();
    },
    async query(input, config) {
      const session = await getDefaultSession();
      return session.query(input, config);
    },
    async *stream(input, config) {
      const session = await getDefaultSession();
      return yield* session.stream(input, config);
    },
    async resume(payload, config) {
      const session = await getDefaultSession();
      return session.resume(payload, config);
    },
    async *resumeStream(payload, config) {
      const session = await getDefaultSession();
      return yield* session.resumeStream(payload, config);
    },
    openSession,
    createSession,
    async loadSession(optionsOverride) {
      const agent = await loadCodaraAgent({
        ...options,
        ...optionsOverride,
        checkpointer: optionsOverride.checkpointer ?? checkpointer,
      });
      return agent ? createCodaraSession(agent) : undefined;
    },
    async getState() {
      const session = await getDefaultSession();
      return session.getState();
    },
    async reset() {
      const session = await getDefaultSession();
      await session.reset();
    },
    async dispose() {
      const session = await getDefaultSession();
      await session.dispose();
      defaultSessionPromise = undefined;
    },
  };
}

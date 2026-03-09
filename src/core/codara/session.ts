import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import {createSession, type Session} from '@core/sessions';
import {createCodaraAgent} from '@core/codara/agent';
import {mergeCodaraAgentOptions} from '@core/codara/options';
import {loadCodaraSourceProjection} from '@core/codara/source-stack';
import type {CodaraAgentOptions, CodaraSessionOptions} from '@core/codara/types';
import type {
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentStreamConfig,
  AgentStreamOutput,
} from '@core/agents';
import type {HILResumePayload} from '@core/middleware';
import type {SessionState} from '@core/sessions';

interface CodaraSessionHost {
  session(options?: CodaraSessionOptions): Promise<Session>;
  getState(): Promise<SessionState>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
}

/** 创建 Codara 默认 session 宿主。 */
export function createCodaraSessionHost(options: CodaraAgentOptions = {}): CodaraSessionHost {
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  let defaultSessionPromise: Promise<Session> | undefined;

  async function buildSession(optionsOverride: CodaraSessionOptions = {}): Promise<Session> {
    const merged = mergeCodaraAgentOptions(options, optionsOverride, checkpointer);
    const loadedSources = await loadCodaraSourceProjection(merged);

    const checkpoint = await resolveCheckpoint({
      restore: optionsOverride.restore ?? 'latest',
      threadId: merged.threadId,
      checkpointer: merged.checkpointer,
    });

    const agent = await createCodaraAgent(
      {
        ...merged,
        ...(checkpoint ? {checkpoint} : {}),
      },
      loadedSources
    );

    return createSession({
      ...(optionsOverride.sessionId ? {sessionId: optionsOverride.sessionId} : {}),
      agent,
    });
  }

  async function getDefaultSession(): Promise<Session> {
    if (!defaultSessionPromise) {
      defaultSessionPromise = buildSession({
        ...(options.threadId ? {threadId: options.threadId} : {}),
        ...(options.messages ? {messages: options.messages} : {}),
        ...(options.context ? {context: options.context} : {}),
      });
    }
    return defaultSessionPromise;
  }

  async function getDefaultAgent() {
    return (await getDefaultSession()).agent();
  }

  return {
    session(optionsOverride) {
      return optionsOverride ? buildSession(optionsOverride) : getDefaultSession();
    },
    async getState() {
      return (await getDefaultSession()).getState();
    },
    async reset() {
      await (await getDefaultSession()).reset();
    },
    async dispose() {
      if (!defaultSessionPromise) {
        return;
      }
      await (await defaultSessionPromise).dispose();
      defaultSessionPromise = undefined;
    },
    async invoke(input, config) {
      return (await getDefaultAgent()).invoke(input, config);
    },
    async *stream(input, config) {
      return yield* (await getDefaultAgent()).stream(input, config);
    },
    async resume(payload, config) {
      return (await getDefaultAgent()).resume(payload, config);
    },
    async *resumeStream(payload, config) {
      return yield* (await getDefaultAgent()).resumeStream(payload, config);
    },
  };
}

async function resolveCheckpoint(options: {
  restore?: 'latest' | 'never';
  threadId?: string;
  checkpointer?: AgentCheckpointer;
}) {
  if (options.restore !== 'latest' || !options.threadId || !options.checkpointer) {
    return undefined;
  }

  return options.checkpointer.getLatest(options.threadId);
}

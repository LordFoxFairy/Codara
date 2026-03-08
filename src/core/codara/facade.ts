import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import {createSession, type Session, type SessionState} from '@core/sessions';
import {createCodaraAgent} from '@core/codara/agent';
import {createCodaraMemory} from '@core/codara/memory';
import {mergeCodaraOptions, resolveCodaraCheckpoint} from '@core/codara/options';
import type {Codara, CreateCodaraOptions, CreateCodaraSessionOptions} from '@core/codara/types';

/** 创建面向 CLI 和产品层的 Codara 入口。 */
export function createCodara(options: CreateCodaraOptions = {}): Codara {
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const memory = createCodaraMemory(options);
  let defaultSessionPromise: Promise<Session> | undefined;

  async function buildSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<Session> {
    const merged = mergeCodaraOptions(options, optionsOverride, checkpointer);
    const checkpoint = await resolveCodaraCheckpoint({
      restore: optionsOverride.restore ?? 'latest',
      threadId: merged.threadId,
      checkpointer: merged.checkpointer,
    });
    const agent = await createCodaraAgent({
      ...merged,
      ...(checkpoint ? {checkpoint} : {}),
    });

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

  return {
    session(optionsOverride) {
      return optionsOverride ? buildSession(optionsOverride) : getDefaultSession();
    },
    memory() {
      return memory;
    },
    async invoke(input, config) {
      return (await getDefaultSession()).agent().invoke(input, config);
    },
    async *stream(input, config) {
      return yield* (await getDefaultSession()).agent().stream(input, config);
    },
    async resume(payload, config) {
      return (await getDefaultSession()).agent().resume(payload, config);
    },
    async *resumeStream(payload, config) {
      return yield* (await getDefaultSession()).agent().resumeStream(payload, config);
    },
    async getState(): Promise<SessionState> {
      return (await getDefaultSession()).getState();
    },
    async reset(): Promise<void> {
      await (await getDefaultSession()).reset();
    },
    async dispose(): Promise<void> {
      if (!defaultSessionPromise) {
        return;
      }
      await (await defaultSessionPromise).dispose();
      defaultSessionPromise = undefined;
    },
  };
}

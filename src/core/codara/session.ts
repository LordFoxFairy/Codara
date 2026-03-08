import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import {createSession, type Session} from '@core/sessions';
import {createCodaraAgent} from '@core/codara/agent';
import type {CreateCodaraAgentOptions, CreateCodaraSessionOptions} from '@core/codara/types';

interface CodaraSessionHost {
  session(options?: CreateCodaraSessionOptions): Promise<Session>;
  getState(): Promise<import('@core/sessions').SessionState>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  invoke: Session['agent'] extends () => infer T
    ? T extends {invoke: infer F}
      ? F
      : never
    : never;
  stream: Session['agent'] extends () => infer T
    ? T extends {stream: infer F}
      ? F
      : never
    : never;
  resume: Session['agent'] extends () => infer T
    ? T extends {resume: infer F}
      ? F
      : never
    : never;
  resumeStream: Session['agent'] extends () => infer T
    ? T extends {resumeStream: infer F}
      ? F
      : never
    : never;
}

/** 创建 Codara 默认 session 宿主。 */
export function createCodaraSessionHost(options: CreateCodaraAgentOptions = {}): CodaraSessionHost {
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  let defaultSessionPromise: Promise<Session> | undefined;

  async function buildSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<Session> {
    const merged = mergeCodaraAgentOptions(options, optionsOverride, checkpointer);
    const checkpoint = await resolveCheckpoint({
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
  };
}

function mergeCodaraAgentOptions(
  base: CreateCodaraAgentOptions,
  override: CreateCodaraAgentOptions,
  checkpointer: AgentCheckpointer
): CreateCodaraAgentOptions {
  return {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    builtinTools: override.builtinTools ?? base.builtinTools,
    cwd: override.cwd ?? base.cwd,
    model: override.model ?? base.model,
    alias: override.alias ?? base.alias,
    catalog: override.catalog ?? base.catalog,
    modelResolver: override.modelResolver ?? base.modelResolver,
    config: override.config ?? base.config,
    threadId: override.threadId ?? base.threadId,
    checkpointer: override.checkpointer ?? base.checkpointer ?? checkpointer,
    checkpoint: override.checkpoint ?? base.checkpoint,
    middleware: override.middleware ?? override.middlewares ?? base.middleware ?? base.middlewares,
    messages: override.messages ?? base.messages,
    context: override.context ?? base.context,
    state: override.state ?? base.state,
    handleToolErrors: override.handleToolErrors ?? base.handleToolErrors,
    skills: mergeSkillsOptions(base.skills, override.skills),
    guidelines: override.guidelines ?? base.guidelines,
    memory: override.memory ?? base.memory,
    summary: override.summary ?? base.summary,
    hil: override.hil ?? base.hil,
    logging: override.logging ?? base.logging,
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

function mergeSkillsOptions(
  base: CreateCodaraAgentOptions['skills'],
  override: CreateCodaraAgentOptions['skills']
): CreateCodaraAgentOptions['skills'] {
  if (override === false) {
    return false;
  }
  if (override !== undefined) {
    if (base === false) {
      return override;
    }
    return {
      ...(base ?? {}),
      ...override,
    };
  }
  return base;
}

import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import {createSession, type Session} from '@core/sessions';
import {createCodaraAgent} from '@core/codara/agent';
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
import {loadGuidelines} from '@core/middleware/guidelines';
import {loadMemory} from '@core/middleware/memory';
import type {HILResumePayload} from '@core/middleware';
import type {SessionState} from '@core/sessions';

interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

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
    const loadedSources = await loadSessionSources(merged);

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

async function loadSessionSources(options: CodaraAgentOptions): Promise<CodaraSourceProjection> {
  const [guidelines, memory] = await Promise.all([
    options.guidelines === false ? Promise.resolve(undefined) : loadGuidelines(resolveGuidelinesOptions(options)),
    options.memory === false ? Promise.resolve(undefined) : loadMemory(resolveMemoryOptions(options)),
  ]);

  return {
    guidelines: guidelines?.content,
    memory: memory?.content,
  };
}

function mergeCodaraAgentOptions(
  base: CodaraAgentOptions,
  override: CodaraAgentOptions,
  checkpointer: AgentCheckpointer
): CodaraAgentOptions {
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
  base: CodaraAgentOptions['skills'],
  override: CodaraAgentOptions['skills']
): CodaraAgentOptions['skills'] {
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

function resolveGuidelinesOptions(options: CodaraAgentOptions) {
  if (options.guidelines === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.guidelines?.cwd ?? options.cwd ? {cwd: options.guidelines?.cwd ?? options.cwd} : {}),
    ...(options.guidelines?.userHome ? {userHome: options.guidelines.userHome} : {}),
    ...(options.guidelines?.projectRoot ? {projectRoot: options.guidelines.projectRoot} : {}),
  };
}

function resolveMemoryOptions(options: CodaraAgentOptions) {
  if (options.memory === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.memory?.cwd ?? options.cwd ? {cwd: options.memory?.cwd ?? options.cwd} : {}),
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
    ...(typeof options.memory?.maxLines === 'number' ? {maxLines: options.memory.maxLines} : {}),
  };
}

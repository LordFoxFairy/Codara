import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {
  createAgent,
  type Agent,
  type AgentInput,
  type AgentInvokeConfig,
  type AgentResult,
  type AgentResumeConfig,
  type AgentResumeStreamConfig,
  type AgentRuntimeContext,
  type AgentStateSeed,
  type AgentStreamConfig,
  type AgentStreamOutput,
  type CreateAgentOptions,
} from '@core/agents';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointer,
} from '@core/checkpoint/state';
import {
  createHILMiddleware,
  createLoggingMiddleware,
  type BaseMiddleware,
  type HILMiddlewareOptions,
  type HILResumePayload,
  type LoggingMiddlewareOptions,
} from '@core/middleware';
import {createSkillsMiddleware, FileSystemSkillStore, type SkillStore, type SkillsMiddlewareOptions} from '@core/middleware/skills';
import {createCodaraChatModel, type CodaraModelRuntime, type CreateCodaraChatModelOptions, type CreateCodaraModelRuntimeOptions} from '@core/model';
import type {Session} from '@core/sessions';
import {createBuiltinTools} from '@core/tools';

export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
}

export interface CreateCodaraToolsOptions {
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  cwd?: string;
}

export interface CreateCodaraMiddlewaresOptions {
  middleware?: BaseMiddleware[];
  middlewares?: BaseMiddleware[];
  skills?: false | CodaraSkillOptions;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
}

export interface CreateCodaraAgentOptions
  extends Omit<CreateAgentOptions, 'model' | 'tools' | 'middleware' | 'middlewares' | 'checkpoint'>,
    CreateCodaraModelRuntimeOptions,
    CreateCodaraToolsOptions,
    CreateCodaraMiddlewaresOptions {
  model?: BaseChatModel;
  alias?: string;
  runtime?: CodaraModelRuntime;
  modelResolver?: () => Promise<BaseChatModel> | BaseChatModel;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  checkpoint?: AgentCheckpoint;
}

export interface LoadCodaraAgentOptions extends Omit<CreateCodaraAgentOptions, 'checkpoint'> {
  threadId: string;
  checkpointer: AgentCheckpointer;
}

export type CreateCodaraOptions = CreateCodaraAgentOptions;
export type CreateCodaraSessionOptions = CreateCodaraAgentOptions;
export type LoadCodaraSessionOptions = Omit<CreateCodaraAgentOptions, 'threadId'> & {threadId: string};

export interface Codara {
  session(): Promise<Session>;
  query(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  openSession(options?: CreateCodaraSessionOptions): Promise<Session>;
  createSession(options?: CreateCodaraSessionOptions): Promise<Session>;
  loadSession(options: LoadCodaraSessionOptions): Promise<Session | undefined>;
  getState(): Promise<ReturnType<Session['getState']>>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export function createCodaraTools(options: CreateCodaraToolsOptions = {}): StructuredToolInterface[] {
  const extraTools = options.tools ?? [];
  if (options.builtinTools === false) {
    return [...extraTools];
  }

  const builtinTools = createBuiltinTools({cwd: options.cwd});
  const byName = new Map<string, StructuredToolInterface>();

  for (const tool of builtinTools) {
    byName.set(tool.name, tool);
  }

  for (const tool of extraTools) {
    byName.set(tool.name, tool);
  }

  return Array.from(byName.values());
}

export function createCodaraMiddlewares(options: CreateCodaraMiddlewaresOptions = {}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  if (options.logging && options.logging.enabled !== false) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  if (options.skills !== false) {
    middlewares.push(createSkillsMiddleware(resolveSkillsOptions(options.skills)));
  }

  middlewares.push(...(options.middleware ?? options.middlewares ?? []));

  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }

  return middlewares;
}

export async function createCodaraAgent(options: CreateCodaraAgentOptions = {}): Promise<Agent> {
  const model = await resolveCodaraModel(options);
  const seed = buildStateSeed(options);

  return createAgent({
    model,
    tools: createCodaraTools(options),
    middleware: createCodaraMiddlewares(options),
    handleToolErrors: options.handleToolErrors,
    threadId: options.threadId,
    checkpointer: options.checkpointer,
    ...(options.checkpoint ? {checkpoint: options.checkpoint} : {}),
    ...(seed ? {state: seed} : {}),
  });
}

export async function loadCodaraAgent(options: LoadCodaraAgentOptions): Promise<Agent | undefined> {
  const checkpoint = await options.checkpointer.getLatest(options.threadId);
  if (!checkpoint) {
    return undefined;
  }

  return createCodaraAgent({
    ...options,
    checkpoint,
  });
}

export function createCodara(options: CreateCodaraOptions = {}): Codara {
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  let defaultSessionPromise: Promise<Session> | undefined;

  async function openSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<Session> {
    const merged = mergeCodaraOptions(options, optionsOverride, checkpointer);
    if (merged.threadId) {
      const restored = await loadCodaraAgent({
        ...merged,
        threadId: merged.threadId,
        checkpointer: merged.checkpointer!,
      });
      if (restored) {
        return createSessionFromAgent(restored);
      }
    }

    return createSessionFromAgent(await createCodaraAgent(merged));
  }

  async function createNewSession(optionsOverride: CreateCodaraSessionOptions = {}): Promise<Session> {
    const merged = mergeCodaraOptions(options, optionsOverride, checkpointer);
    return createSessionFromAgent(await createCodaraAgent(merged));
  }

  function getDefaultSession(): Promise<Session> {
    if (!defaultSessionPromise) {
      defaultSessionPromise = openSession({
        ...(options.threadId ? {threadId: options.threadId} : {}),
        ...(options.messages ? {messages: options.messages} : {}),
        ...(options.context ? {context: options.context} : {}),
      });
    }
    return defaultSessionPromise;
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
    createSession: createNewSession,
    async loadSession(optionsOverride) {
      const merged = mergeCodaraOptions(options, optionsOverride, checkpointer);
      const restored = await loadCodaraAgent({
        ...merged,
        threadId: optionsOverride.threadId,
        checkpointer: merged.checkpointer!,
      });
      return restored ? createSessionFromAgent(restored) : undefined;
    },
    async getState() {
      return (await getDefaultSession()).getState();
    },
    async reset() {
      await (await getDefaultSession()).reset();
    },
    async dispose() {
      await (await getDefaultSession()).dispose();
      defaultSessionPromise = undefined;
    },
  };
}

function createSessionFromAgent(agent: Agent): Session {
  return {
    query(input, config) {
      return agent.invoke(input, config);
    },
    stream(input, config) {
      return agent.stream(input, config);
    },
    resume(payload, config) {
      return agent.resume(payload, config);
    },
    resumeStream(payload, config) {
      return agent.resumeStream(payload, config);
    },
    getState() {
      return agent.getState();
    },
    reset() {
      return agent.reset();
    },
    dispose() {
      return agent.dispose();
    },
  };
}

function mergeCodaraOptions(
  base: CreateCodaraAgentOptions,
  override: CreateCodaraAgentOptions,
  checkpointer: AgentCheckpointer
): CreateCodaraAgentOptions {
  return {
    ...base,
    ...override,
    checkpointer: override.checkpointer ?? base.checkpointer ?? checkpointer,
  };
}

function buildStateSeed(options: CreateCodaraAgentOptions): AgentStateSeed | undefined {
  const seed =
    options.state || options.messages || options.context
      ? {
          ...(options.state ?? {}),
          ...(options.messages ? {messages: options.messages} : {}),
          ...(options.context ? {context: options.context} : {}),
        }
      : undefined;
  return seed;
}

async function resolveCodaraModel(options: CreateCodaraAgentOptions): Promise<BaseChatModel> {
  if (options.modelResolver) {
    return await options.modelResolver();
  }

  if (options.model) {
    return options.model;
  }

  return createCodaraChatModel({
    config: options.config,
    alias: options.alias,
    runtime: options.runtime,
  } satisfies CreateCodaraChatModelOptions);
}

function resolveSkillsOptions(
  options: false | CodaraSkillOptions | undefined
): SkillsMiddlewareOptions {
  const resolved = options === false ? undefined : options;

  if (resolved?.store) {
    return {store: resolved.store};
  }

  return {
    store: new FileSystemSkillStore({
      ...(resolved?.sources ? {sources: resolved.sources} : {}),
      ...(resolved?.projectRoot ? {projectRoot: resolved.projectRoot} : {}),
      ...(resolved?.userHome ? {userHome: resolved.userHome} : {}),
      ...(typeof resolved?.cacheTtlMs === 'number' ? {cacheTtlMs: resolved.cacheTtlMs} : {}),
    }),
  };
}

export * from '@core/model';
export * from '@core/sessions';

import type {
  Agent,
  AgentInput,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentRunConfig,
  CreateAgentOptions,
  LoadAgentOptions,
} from '@core/agents/agent';
import {createAgent, loadAgent} from '@core/agents/agent';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentInstanceState, AgentCheckpointer} from '@core/checkpoint/state';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import {createHILMiddleware, createLoggingMiddleware, createSkillsMiddleware, type HILResumePayload} from '@core/middleware';
import {createCodaraChatModel, type CodaraModelRuntime, type CreateCodaraModelRuntimeOptions} from '@core/model';
import {FileSystemSkillStore} from '@core/skills/store';
import type {SkillStore} from '@core/skills/types';
import {createBuiltinTools, type BuiltinToolOptions} from '@core/tools';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/stream';

type CodaraQueryResult = Awaited<ReturnType<Agent['invoke']>>;
type CodaraResumeResult = Awaited<ReturnType<Agent['resume']>>;

interface SkillRuntimeOptions {
  store?: SkillStore;
  sources?: string[];
  userHome?: string;
  projectRoot?: string;
  cacheTtlMs?: number;
}

export interface CodaraRuntimeOptions {
  middlewares?: BaseMiddleware[];
  /**
   * Codara 对外入口默认启用 SkillsMiddleware。
   * 显式传 `false` 时关闭。
   */
  skills?: false | SkillRuntimeOptions;
  /**
   * 记录中间件在对外 facade 层保持按需开启，
   * 避免默认干扰 CLI 的输出形态。
   */
  logging?: false | LoggingMiddlewareOptions;
  /**
   * 对外入口默认启用 HIL，保证终端宿主具备暂停/恢复协议。
   * 显式传 `false` 时移除默认 HIL。
   */
  hil?: false | HILMiddlewareOptions;
}

interface CodaraModelSelectionOptions extends CreateCodaraModelRuntimeOptions {
  model?: BaseChatModel;
  alias?: string;
  modelRuntime?: CodaraModelRuntime;
  modelResolver?: CodaraModelResolver;
}

export interface CreateCodaraAgentOptions
  extends Omit<CreateAgentOptions, 'middlewares' | 'model'>,
    CodaraRuntimeOptions,
    CodaraModelSelectionOptions,
    CodaraToolRuntimeOptions {}

export interface LoadCodaraAgentOptions
  extends Omit<LoadAgentOptions, 'middlewares' | 'model'>,
    CodaraRuntimeOptions,
    CodaraModelSelectionOptions,
    CodaraToolRuntimeOptions {}

export interface CreateCodaraOptions
  extends Omit<CreateCodaraAgentOptions, 'threadId' | 'messages' | 'context' | 'checkpointer'> {
  threadId?: string;
  messages?: CreateAgentOptions['messages'];
  context?: CreateAgentOptions['context'];
  checkpointer?: AgentCheckpointer;
}

export interface CreateCodaraSessionOptions
  extends Omit<CreateCodaraAgentOptions, 'checkpointer'> {
  checkpointer?: AgentCheckpointer;
}

export interface LoadCodaraSessionOptions
  extends Omit<LoadCodaraAgentOptions, 'checkpointer'> {
  checkpointer?: AgentCheckpointer;
}

export interface CodaraToolRuntimeOptions {
  /**
   * Codara 默认附带内置工具栈。
   * 显式传 `false` 时关闭。
   */
  builtinTools?: false | BuiltinToolOptions;
}

export type CodaraModelResolver = (options: CodaraModelSelectionOptions) => Promise<BaseChatModel>;

export class CodaraSession {
  constructor(private readonly agent: Agent) {}

  getThreadId(): string {
    return this.agent.getState().threadId;
  }

  query(input?: AgentInput, config?: AgentRunConfig) {
    return this.agent.invoke(input, config);
  }

  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, CodaraQueryResult, void> {
    return this.agent.stream(input, config);
  }

  resume(payload: HILResumePayload, config?: AgentResumeConfig) {
    return this.agent.resume(payload, config);
  }

  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraResumeResult, void> {
    return this.agent.resumeStream(payload, config);
  }

  getState(): AgentInstanceState {
    return this.agent.getState();
  }

  saveCheckpoint() {
    return this.agent.saveCheckpoint();
  }

  reset() {
    return this.agent.reset();
  }

  dispose() {
    return this.agent.dispose();
  }

  deleteCheckpoints() {
    return this.agent.deleteCheckpoints();
  }
}

export class Codara {
  private readonly checkpointer: AgentCheckpointer;
  private defaultSessionPromise?: Promise<CodaraSession>;

  constructor(private readonly options: CreateCodaraOptions = {}) {
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  }

  session(): Promise<CodaraSession> {
    if (!this.defaultSessionPromise) {
      this.defaultSessionPromise = this.openSession({
        ...(this.options.threadId ? {threadId: this.options.threadId} : {}),
        ...(this.options.messages ? {messages: this.options.messages} : {}),
        ...(this.options.context ? {context: this.options.context} : {}),
      });
    }

    return this.defaultSessionPromise;
  }

  async query(input?: AgentInput, config?: AgentRunConfig) {
    const session = await this.session();
    return session.query(input, config);
  }

  async *stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraQueryResult, void> {
    const session = await this.session();
    return yield* session.stream(input, config);
  }

  async resume(payload: HILResumePayload, config?: AgentResumeConfig) {
    const session = await this.session();
    return session.resume(payload, config);
  }

  async *resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, CodaraResumeResult, void> {
    const session = await this.session();
    return yield* session.resumeStream(payload, config);
  }

  /**
   * 按 thread 语义打开 session。
   * - 有现成 checkpoint 时优先恢复
   * - 不存在时回退为新建
   */
  async openSession(options: CreateCodaraSessionOptions = {}): Promise<CodaraSession> {
    if (options.threadId) {
      const restored = await loadCodaraAgent({
        ...this.options,
        ...options,
        threadId: options.threadId,
        checkpointer: options.checkpointer ?? this.checkpointer,
      });

      if (restored) {
        return new CodaraSession(restored);
      }
    }

    return this.createSession(options);
  }

  async createSession(options: CreateCodaraSessionOptions = {}): Promise<CodaraSession> {
    const agent = await createCodaraAgent({
      ...this.options,
      ...options,
      checkpointer: options.checkpointer ?? this.checkpointer,
    });
    return new CodaraSession(agent);
  }

  async loadSession(options: LoadCodaraSessionOptions): Promise<CodaraSession | undefined> {
    const agent = await loadCodaraAgent({
      ...this.options,
      ...options,
      checkpointer: options.checkpointer ?? this.checkpointer,
    });
    return agent ? new CodaraSession(agent) : undefined;
  }

  async getState(): Promise<AgentInstanceState> {
    const session = await this.session();
    return session.getState();
  }

  async reset(): Promise<void> {
    const session = await this.session();
    await session.reset();
  }

  async dispose(): Promise<void> {
    const session = await this.session();
    await session.dispose();
    this.defaultSessionPromise = undefined;
  }
}

/**
 * 构建 Codara 默认 middleware 栈。
 * - 默认开启 skills
 * - logging 按需开启
 * - 调用方自定义 middleware 先于 HIL 执行，便于工具策略提前短路
 * - HIL 放在最后，作为最终交互闸门
 */
export function createCodaraMiddlewares(options: CodaraRuntimeOptions = {}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];

  if (options.logging !== false && options.logging !== undefined) {
    middlewares.push(createLoggingMiddleware(options.logging));
  }

  if (options.skills !== false) {
    middlewares.push(
      createSkillsMiddleware({
        store: resolveSkillStore(options.skills),
      })
    );
  }

  if (options.middlewares?.length) {
    middlewares.push(...options.middlewares);
  }

  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil));
  }

  return middlewares;
}

/**
 * 构建 Codara 默认工具栈。
 * - 默认启用内置工具
 * - 调用方工具追加在后
 * - 若工具名重复，调用方工具覆盖内置工具
 */
export function createCodaraTools(options: CodaraToolRuntimeOptions & {tools?: StructuredToolInterface[]} = {}): StructuredToolInterface[] {
  const merged = new Map<string, StructuredToolInterface>();

  if (options.builtinTools !== false) {
    const builtinTools = createBuiltinTools(options.builtinTools || {});
    for (const tool of builtinTools) {
      merged.set(tool.name, tool);
    }
  }

  for (const tool of options.tools ?? []) {
    if (merged.has(tool.name)) {
      merged.delete(tool.name);
    }
    merged.set(tool.name, tool);
  }

  return [...merged.values()];
}

export function createCodara(options: CreateCodaraOptions = {}): Codara {
  return new Codara(options);
}

/**
 * Codara 对外的高级 Agent 工厂。
 * 调用方既可以直接传现成 `model`，
 * 也可以只传 `alias`，由 Codara 自动解析模型运行时配置。
 */
export async function createCodaraAgent(options: CreateCodaraAgentOptions): Promise<Agent> {
  const agentOptions = stripCodaraFacadeOptions(options);
  const model = await resolveCodaraModel(options);
  return createAgent({
    ...agentOptions,
    model,
    tools: createCodaraTools(options),
    middlewares: createCodaraMiddlewares(options),
  });
}

export async function loadCodaraAgent(options: LoadCodaraAgentOptions): Promise<Agent | undefined> {
  const agentOptions = stripCodaraFacadeOptions(options);
  const model = await resolveCodaraModel(options);
  return loadAgent({
    ...agentOptions,
    model,
    tools: createCodaraTools(options),
    middlewares: createCodaraMiddlewares(options),
  });
}

function resolveSkillStore(options: false | SkillRuntimeOptions | undefined): SkillStore {
  if (options && options.store) {
    return options.store;
  }

  const resolved = options || undefined;
  return new FileSystemSkillStore({
    ...(resolved?.sources ? {sources: resolved.sources} : {}),
    ...(resolved?.userHome ? {userHome: resolved.userHome} : {}),
    ...(resolved?.projectRoot ? {projectRoot: resolved.projectRoot} : {}),
    ...(resolved?.cacheTtlMs !== undefined ? {cacheTtlMs: resolved.cacheTtlMs} : {}),
  });
}

async function resolveCodaraModel(options: CodaraModelSelectionOptions): Promise<BaseChatModel> {
  if (options.model) {
    return options.model;
  }

  if (options.modelResolver) {
    return options.modelResolver(options);
  }

  return createCodaraChatModel({
    ...(options.alias ? {alias: options.alias} : {}),
    ...(options.modelRuntime ? {runtime: options.modelRuntime} : {}),
    ...(options.config ? {config: options.config} : {}),
  });
}

function stripCodaraFacadeOptions<
  T extends CodaraModelSelectionOptions & CodaraToolRuntimeOptions & {tools?: StructuredToolInterface[]}
>(options: T): Omit<T, 'model' | 'alias' | 'modelRuntime' | 'config' | 'modelResolver' | 'builtinTools' | 'tools'> {
  const clone = {...options};
  delete clone.model;
  delete clone.alias;
  delete clone.modelRuntime;
  delete clone.config;
  delete clone.modelResolver;
  delete clone.builtinTools;
  delete clone.tools;
  return clone;
}

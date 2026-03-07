import type {
  Agent,
  CreateAgentOptions,
  LoadAgentOptions,
} from '@core/agents/agent';
import {createAgent, loadAgent} from '@core/agents/agent';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import {createHILMiddleware, createLoggingMiddleware, createSkillsMiddleware} from '@core/middleware';
import {createCodaraChatModel, type CodaraModelRuntime, type CreateCodaraModelRuntimeOptions} from '@core/model';
import {FileSystemSkillStore} from '@core/skills/store';
import type {SkillStore} from '@core/skills/types';
import {createBuiltinTools, type BuiltinToolOptions} from '@core/tools';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';

interface SkillOptions {
  store?: SkillStore;
  sources?: string[];
  userHome?: string;
  projectRoot?: string;
  cacheTtlMs?: number;
}

export interface CodaraMiddlewareOptions {
  /** 中间件数组的单数入口别名。 */
  middleware?: BaseMiddleware[];
  middlewares?: BaseMiddleware[];
  /**
   * Codara 对外入口默认启用 SkillsMiddleware。
   * 显式传 `false` 时关闭。
   */
  skills?: false | SkillOptions;
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

interface CodaraModelOptions extends CreateCodaraModelRuntimeOptions {
  model?: BaseChatModel;
  alias?: string;
  modelRuntime?: CodaraModelRuntime;
  modelResolver?: CodaraModelResolver;
}

export interface CodaraToolOptions {
  /**
   * Codara 默认附带内置工具栈。
   * 显式传 `false` 时关闭。
   */
  builtinTools?: false | BuiltinToolOptions;
}

export interface CreateCodaraAgentOptions
  extends Omit<CreateAgentOptions, 'middleware' | 'middlewares' | 'model'>,
    CodaraMiddlewareOptions,
    CodaraModelOptions,
    CodaraToolOptions {}

export interface LoadCodaraAgentOptions
  extends Omit<LoadAgentOptions, 'middleware' | 'middlewares' | 'model'>,
    CodaraMiddlewareOptions,
    CodaraModelOptions,
    CodaraToolOptions {}

export type CodaraModelResolver = (options: CodaraModelOptions) => Promise<BaseChatModel>;

/**
 * 构建 Codara 默认 middleware 栈。
 * - 默认开启 skills
 * - logging 按需开启
 * - 调用方自定义 middleware 先于 HIL 执行，便于工具策略提前短路
 * - HIL 放在最后，作为最终交互闸门
 */
export function createCodaraMiddlewares(options: CodaraMiddlewareOptions = {}): BaseMiddleware[] {
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
  } else if (options.middleware?.length) {
    middlewares.push(...options.middleware);
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
export function createCodaraTools(
  options: CodaraToolOptions & {tools?: StructuredToolInterface[]} = {}
): StructuredToolInterface[] {
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

function resolveSkillStore(options: false | SkillOptions | undefined): SkillStore {
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

async function resolveCodaraModel(options: CodaraModelOptions): Promise<BaseChatModel> {
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
  T extends CodaraModelOptions &
    CodaraToolOptions &
    CodaraMiddlewareOptions & {tools?: StructuredToolInterface[]}
>(options: T): Omit<T, 'model' | 'alias' | 'modelRuntime' | 'config' | 'modelResolver' | 'builtinTools' | 'tools'> {
  const clone = {...options};
  delete clone.model;
  delete clone.alias;
  delete clone.modelRuntime;
  delete clone.config;
  delete clone.modelResolver;
  delete clone.builtinTools;
  delete clone.middleware;
  delete clone.middlewares;
  delete clone.tools;
  return clone;
}

export type {AgentCheckpointer};

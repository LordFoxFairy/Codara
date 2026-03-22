import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/pipeline/types';
import {MIDDLEWARE_NAMES} from '@core/pipeline/types';
import type {LoggingMiddlewareOptions} from '@core/middleware';
import {
  createAskUserQuestionMiddleware,
  createBudgetMiddleware,
  createDailySessionFileLogSink,
  createReviewMiddleware,
  createLoggingMiddleware,
  createPathInstructionsMiddleware,
  createSkillsMiddleware,
  createTodoListMiddleware,
} from '@core/middleware';
import {createPermissionMiddleware} from '@core/middleware/permission';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import type {ApprovalStore} from '@durability/approval-store';
import {
  createAgentMiddleware,
  type AgentRuntime,
  type AgentRunStore,
  createAgentTool,
  readAgentToolOptions,
  AGENT_TOOL_NAME,
} from '@capability/subagent';
import {
  createTaskMiddleware,
  type TaskStore,
} from '@capability/task';
import type {HookPipeline} from '@observability/hook';
import {createToolHooksBridge} from '@observability/hook';
import type {GuidelinesSource} from '@context/instructions/guidelines';
import type {PromptSource} from '@context/prompts/prompt-source';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {ChannelRegistry} from '@integration/channel';
import {createChannelReviewOptions} from '@integration/channel';
import type {
  CodaraMiddlewareOptions,
  CodaraRuntimeOptions,
} from '../types';
import {createCodaraChatModel, type CodaraModelCatalog} from './runtime';

const DEFAULT_RUNTIME_FILE_LOGGING_ENABLED = true;

export function resolveRuntimeLoggingOptions(
  options: Pick<CodaraRuntimeOptions, 'logging' | 'cwd' | 'projectRoot'>,
): false | LoggingMiddlewareOptions {
  if (
    !DEFAULT_RUNTIME_FILE_LOGGING_ENABLED ||
    options.logging === false ||
    options.logging?.enabled === false
  ) {
    return false;
  }

  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const rootDir = path.join(projectRoot, '.codara', 'sessions');
  const provided = options.logging ?? {};

  return {
    ...provided,
    enabled: true,
    logger: provided.logger ?? createDailySessionFileLogSink({rootDir}),
  };
}
export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
  channelRegistry?: ChannelRegistry,
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  if (options.logging) {
    middlewares.push(createLoggingMiddleware(options.logging as LoggingMiddlewareOptions));
  }
  if (!options.middleware?.some((middleware) => middleware.name === MIDDLEWARE_NAMES.Skills)) {
    middlewares.push(createSkillsMiddleware());
  }
  middlewares.push(...(options.middleware ?? []));
  middlewares.push(createBudgetMiddleware());
  if (options.review !== false) {
    const reviewOptions = channelRegistry
      ? {...(options.review ?? {}), ...createChannelReviewOptions(channelRegistry)}
      : (options.review ?? {});
    middlewares.push(createReviewMiddleware(reviewOptions));
  }
  return middlewares;
}

export function createRuntimeDefaultMiddlewares(input: {
  options: CodaraRuntimeOptions;
  runtimeTools: StructuredToolInterface[];
  taskStore: TaskStore;
  agentRunStore: AgentRunStore;
  agentRuntime: AgentRuntime;
  taskCheckpointer: AgentCheckpointer;
  approvalStore: ApprovalStore;
  logging: false | LoggingMiddlewareOptions;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  promptSource: PromptSource;
  guidelinesSource: GuidelinesSource;
  hookPipeline?: HookPipeline;
  channelRegistry?: ChannelRegistry;
}): BaseMiddleware[] {
  const callerMiddlewares = input.options.middleware ?? [];
  const byName = new Map<string, BaseMiddleware>();
  rebindRuntimeAgentTools({
    tools: input.runtimeTools,
    agentRunStore: input.agentRunStore,
    agentRuntime: input.agentRuntime,
    taskCheckpointer: input.taskCheckpointer,
    approvalStore: input.approvalStore,
  });
  const providedToolNames = collectProvidedToolNames({
    tools: input.options.tools,
    middlewares: callerMiddlewares,
  });
  for (const middleware of callerMiddlewares) {
    byName.set(middleware.name, middleware);
  }

  if (!byName.has(MIDDLEWARE_NAMES.PathInstructions)) {
    byName.set(
      MIDDLEWARE_NAMES.PathInstructions,
      createPathInstructionsMiddleware({
        guidelinesSource: input.guidelinesSource,
        promptSource: input.promptSource,
      }),
    );
  }

  if (!byName.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    byName.set(MIDDLEWARE_NAMES.TodoList, createTodoListMiddleware());
  }

  if (!byName.has(MIDDLEWARE_NAMES.Task) && !providedToolNames.has('TaskCreate')) {
    byName.set(
      MIDDLEWARE_NAMES.Task,
      createTaskMiddleware({
        store: input.taskStore,
      }),
    );
  }

  if (!byName.has(MIDDLEWARE_NAMES.Agent) && !providedToolNames.has('Agent')) {
    byName.set(
      MIDDLEWARE_NAMES.Agent,
        createAgentMiddleware({
        runStore: input.agentRunStore,
        runtime: input.agentRuntime,
        checkpointer: input.taskCheckpointer,
        approvalStore: input.approvalStore,
        model: input.options.model ?? (() => createCodaraChatModel({
          alias: input.options.alias,
          config: input.options.config,
          ...(input.catalog ? {catalog: input.catalog} : {}),
        })),
        tools: input.runtimeTools,
        childRuntime: {
          logging: input.logging,
          review: input.options.review ?? {},
          cwd: input.options.cwd,
          projectRoot: input.options.projectRoot,
          userHome: input.options.userHome,
          permissionAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
        },
        ...(input.hookPipeline ? {childLifecycle: input.hookPipeline} : {}),
      }),
    );
  }

  if (input.options.review !== false && !byName.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    byName.set(MIDDLEWARE_NAMES.AskUserQuestion, createAskUserQuestionMiddleware());
  }

  if (input.options.review !== false && !byName.has(MIDDLEWARE_NAMES.Permission)) {
    byName.set(
      MIDDLEWARE_NAMES.Permission,
      createPermissionMiddleware({
        ...(typeof input.options.review === 'object' && input.options.review !== null
          ? input.options.review
          : {}),
        cwd: input.options.cwd,
        projectRoot: input.options.projectRoot,
        userHome: input.options.userHome,
        bashAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
      }),
    );
  }

  if (input.hookPipeline) {
    byName.set(
      MIDDLEWARE_NAMES.ToolHooks,
      createToolHooksBridge(input.hookPipeline),
    );
  }

  return [...byName.values()];
}

function rebindRuntimeAgentTools(input: {
  tools: StructuredToolInterface[];
  agentRunStore: AgentRunStore;
  agentRuntime: AgentRuntime;
  taskCheckpointer: AgentCheckpointer;
  approvalStore: ApprovalStore;
}): void {
  for (let index = 0; index < input.tools.length; index += 1) {
    const tool = input.tools[index];
    if (!tool || tool.name !== AGENT_TOOL_NAME) {
      continue;
    }

    const agentOptions = readAgentToolOptions(tool);
    if (!agentOptions) {
      continue;
    }

    input.tools[index] = createAgentTool({
      ...agentOptions,
      runStore: input.agentRunStore,
      runtime: input.agentRuntime,
      checkpointer: input.taskCheckpointer,
      approvalStore: input.approvalStore,
    });
  }
}

function collectProvidedToolNames(input: {
  tools?: StructuredToolInterface[];
  middlewares?: BaseMiddleware[];
}): Set<string> {
  const names = new Set<string>();
  for (const tool of input.tools ?? []) {
    names.add(tool.name);
  }
  for (const middleware of input.middlewares ?? []) {
    for (const tool of middleware.tools ?? []) {
      names.add(tool.name);
    }
  }
  return names;
}

function createRuntimePermissionAnalysisModel(
  options: Pick<CodaraRuntimeOptions, 'alias' | 'config' | 'model'>,
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>,
) {
  if (options.model) {
    return typeof options.model === 'function'
      ? (options.model as () => Promise<BaseChatModel>)
      : options.model;
  }

  if (catalog) {
    return () => createCodaraChatModel({
      alias: options.alias,
      config: options.config,
      catalog,
    });
  }

  return undefined;
}

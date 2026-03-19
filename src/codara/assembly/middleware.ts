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
  createHILMiddleware,
  createLoggingMiddleware,
  createPathInstructionsMiddleware,
  createSkillsMiddleware,
  createTodoListMiddleware,
} from '@core/middleware';
import {createPermissionMiddleware} from '@core/middleware/permission';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import type {ApprovalStore} from '@durability/approval-store';
import {
  createTaskMiddleware,
  type TaskRuntime,
  type TaskRunStore,
  type TaskStore,
} from '@capability/task';
import {
  createTaskTool,
  readTaskToolOptions,
  TASK_TOOL_NAME,
} from '@capability/task/middleware';
import {createTeamMiddleware} from '@capability/team/middleware';
import type {TeamRegistry} from '@capability/team/coordination/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {SharedState} from '@capability/team/shared-state';
import type {HookPipeline} from '@observability/hook';
import {createToolHooksBridge} from '@observability/hook';
import type {GuidelinesSource} from '@context/instructions/guidelines';
import type {PromptSource} from '@context/prompts/prompt-source';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {ChannelRegistry} from '@integration/channel';
import {createChannelHILOptions} from '@integration/channel';
import type {
  CodaraMiddlewareOptions,
  CodaraRuntimeOptions,
} from '../types';
import {createInstructionContextPreparer} from './context';
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
  if (options.hil !== false) {
    const hilOptions = channelRegistry
      ? {...(options.hil ?? {}), ...createChannelHILOptions(channelRegistry)}
      : (options.hil ?? {});
    middlewares.push(createHILMiddleware(hilOptions));
  }
  return middlewares;
}

export function createRuntimeDefaultMiddlewares(input: {
  options: CodaraRuntimeOptions;
  runtimeTools: StructuredToolInterface[];
  taskStore: TaskStore;
  taskRunStore: TaskRunStore;
  taskRuntime: TaskRuntime;
  taskCheckpointer: AgentCheckpointer;
  approvalStore: ApprovalStore;
  logging: false | LoggingMiddlewareOptions;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  promptSource: PromptSource;
  guidelinesSource: GuidelinesSource;
  hookPipeline?: HookPipeline;
  teamRegistry?: TeamRegistry;
  teamRuntime?: TeamRuntime;
  teamSharedState?: SharedState;
  channelRegistry?: ChannelRegistry;
}): BaseMiddleware[] {
  const callerMiddlewares = input.options.middleware ?? [];
  const byName = new Map<string, BaseMiddleware>();
  rebindRuntimeTaskTools({
    tools: input.runtimeTools,
    taskRunStore: input.taskRunStore,
    taskRuntime: input.taskRuntime,
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

  if (!byName.has(MIDDLEWARE_NAMES.Task) && !providedToolNames.has('Task')) {
    byName.set(
      MIDDLEWARE_NAMES.Task,
      createTaskMiddleware({
        store: input.taskStore,
        runStore: input.taskRunStore,
        runtime: input.taskRuntime,
        checkpointer: input.taskCheckpointer,
        approvalStore: input.approvalStore,
        model: input.options.model ?? (() => createCodaraChatModel({
          alias: input.options.alias,
          config: input.options.config,
          ...(input.catalog ? {catalog: input.catalog} : {}),
        })),
        tools: input.runtimeTools,
        prepareContext: createInstructionContextPreparer({
          promptSource: input.promptSource,
          guidelinesSource: input.guidelinesSource,
        }),
        middleware: createDelegatedRuntimeMiddlewares({
          ...input,
          tools: input.runtimeTools,
          catalog: input.catalog,
        }),
        ...(input.hookPipeline ? {lifecycle: input.hookPipeline} : {}),
      }),
    );
  }

  if (
    input.teamRegistry &&
    input.teamRuntime &&
    input.teamSharedState &&
    !byName.has(MIDDLEWARE_NAMES.Team)
  ) {
    byName.set(MIDDLEWARE_NAMES.Team, createTeamMiddleware({
      teamType: 'leader',
      registry: input.teamRegistry,
      runtime: input.teamRuntime,
      sharedState: input.teamSharedState,
    }));
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    byName.set(MIDDLEWARE_NAMES.AskUserQuestion, createAskUserQuestionMiddleware());
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.Permission)) {
    byName.set(
      MIDDLEWARE_NAMES.Permission,
      createPermissionMiddleware({
        ...(typeof input.options.hil === 'object' && input.options.hil !== null
          ? input.options.hil
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

function rebindRuntimeTaskTools(input: {
  tools: StructuredToolInterface[];
  taskRunStore: TaskRunStore;
  taskRuntime: TaskRuntime;
  taskCheckpointer: AgentCheckpointer;
  approvalStore: ApprovalStore;
}): void {
  for (let index = 0; index < input.tools.length; index += 1) {
    const tool = input.tools[index];
    if (!tool || tool.name !== TASK_TOOL_NAME) {
      continue;
    }

    const taskOptions = readTaskToolOptions(tool);
    if (!taskOptions) {
      continue;
    }

    input.tools[index] = createTaskTool({
      ...taskOptions,
      runStore: input.taskRunStore,
      runtime: input.taskRuntime,
      checkpointer: input.taskCheckpointer,
      approvalStore: input.approvalStore,
    });
  }
}

function createDelegatedRuntimeMiddlewares(input: {
  options: CodaraRuntimeOptions;
  taskStore: TaskStore;
  logging: false | LoggingMiddlewareOptions;
  tools?: StructuredToolInterface[];
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
}): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  const callerMiddlewares = (input.options.middleware ?? [])
    .filter((middleware) => middleware.name !== MIDDLEWARE_NAMES.Task && middleware.name !== MIDDLEWARE_NAMES.Team);
  const providedToolNames = collectProvidedToolNames({
    tools: input.tools,
    middlewares: callerMiddlewares,
  });

  const seen = new Set<string>();
  const push = (middleware: BaseMiddleware) => {
    if (seen.has(middleware.name)) {
      return;
    }
    seen.add(middleware.name);
    middlewares.push(middleware);
  };

  if (input.logging && input.logging.enabled !== false) {
    push(createLoggingMiddleware(input.logging));
  }

  for (const middleware of callerMiddlewares) {
    push(middleware);
  }

  if (!seen.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    push(createTodoListMiddleware());
  }
  if (input.options.hil !== false && !seen.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    push(createAskUserQuestionMiddleware());
  }
  if (input.options.hil !== false && !seen.has(MIDDLEWARE_NAMES.Permission)) {
    push(createPermissionMiddleware({
      ...(typeof input.options.hil === 'object' && input.options.hil !== null ? input.options.hil : {}),
      cwd: input.options.cwd,
      projectRoot: input.options.projectRoot,
      userHome: input.options.userHome,
      bashAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
    }));
  }

  push(createBudgetMiddleware());
  return middlewares;
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

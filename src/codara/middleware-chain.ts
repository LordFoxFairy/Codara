import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentContextPreparer} from '@engine/agent';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@engine/pipeline';
import {
  createBudgetMiddleware,
  createGuidelinesMiddleware,
  createHILMiddleware,
  createAskUserQuestionMiddleware,
  createLoggingMiddleware,
  createSkillsMiddleware,
  MIDDLEWARE_NAMES,
  createTodoListMiddleware,
  createDailySessionFileLogSink,
} from '@engine/pipeline';
import {
  createPermissionMiddleware,
} from '@engine/pipeline/permission';
import {
  createSharedTaskMiddleware,
  createTaskMiddleware,
  type TaskStore,
} from '@capability/task';
import type {HookPipeline} from '@engine/hook';
import {createToolHooksMiddleware} from '@engine/hook';
import type {GuidelinesSource} from '@infra/context/instructions/guidelines';
import type {PromptSource} from '@infra/context/instructions/prompt';
import {
  applyPreparedInstructionContext,
  buildBaseSystemMessage,
} from '@infra/context/system-message';
import {createBuiltinTools} from '@engine/tool';
import {FileSystemSkillStore, type SkillStore} from '@capability/skill';
import {resolveWorkspaceRoot} from '@infra/config/workspace';
import type {CodaraMiddlewareOptions, CodaraRuntimeOptions, CodaraOptions} from './facade';
import {createCodaraChatModel, type CodaraModelCatalog} from './facade';

// ── Tool Assembly ──

export type CodaraToolsOptions = Pick<CodaraOptions, 'builtinTools' | 'cwd' | 'tools'>;

export function createCodaraTools(options: CodaraToolsOptions = {}): StructuredToolInterface[] {
  if (options.builtinTools === false) {
    return [...(options.tools ?? [])];
  }

  const byName = new Map<string, StructuredToolInterface>();
  for (const tool of createBuiltinTools({cwd: options.cwd, extended: true})) {
    byName.set(tool.name, tool);
  }
  for (const tool of options.tools ?? []) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

// ── Skill Resolution ──

export function resolveCodaraSkills(
  options: Pick<CodaraOptions, 'skills' | 'cwd' | 'projectRoot' | 'userHome'>,
): {store: SkillStore; subagentRoots: string[]} | undefined {
  if (options.skills === false) {
    return undefined;
  }
  if (options.skills?.store) {
    return {store: options.skills.store, subagentRoots: options.skills.subagentRoots ?? []};
  }
  return {
    store: new FileSystemSkillStore({
      ...(options.skills?.sources ? {sources: options.skills.sources} : {}),
      ...((options.skills?.projectRoot || options.projectRoot || options.skills?.cwd || options.cwd)
        ? {
            projectRoot: resolveWorkspaceRoot({
              projectRoot: options.skills?.projectRoot ?? options.projectRoot,
              cwd: options.skills?.cwd ?? options.cwd,
            }),
          }
        : {}),
      ...((options.skills?.cwd || options.cwd) ? {cwd: options.skills?.cwd ?? options.cwd} : {}),
      ...((options.skills?.userHome || options.userHome) ? {userHome: options.skills?.userHome ?? options.userHome} : {}),
      ...(typeof options.skills?.cacheTtlMs === 'number' ? {cacheTtlMs: options.skills.cacheTtlMs} : {}),
      ...(options.skills?.claudeSkillsCompat ? {claudeSkillsCompat: true} : {}),
    }),
    subagentRoots: options.skills?.subagentRoots ?? [],
  };
}

// ── Runtime Logging Resolution ──

const DEFAULT_RUNTIME_FILE_LOGGING_ENABLED = true;

export function resolveRuntimeLoggingOptions(
  options: Pick<CodaraRuntimeOptions, 'logging' | 'cwd' | 'projectRoot'>,
): false | LoggingMiddlewareOptions {
  if (!DEFAULT_RUNTIME_FILE_LOGGING_ENABLED || options.logging === false || options.logging?.enabled === false) {
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

// ── Middleware Assembly ──

export function createCodaraMiddlewares(
  options: CodaraMiddlewareOptions = {},
): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  if (options.logging) {
    middlewares.push(createLoggingMiddleware(options.logging as LoggingMiddlewareOptions));
  }
  // SkillsMiddleware — Skill tool for progressive disclosure.
  // Reads runtime from shared context (injected by SkillsSource via buildBaseSystemMessage).
  if (!options.middleware?.some((m) => m.name === MIDDLEWARE_NAMES.Skills)) {
    middlewares.push(createSkillsMiddleware());
  }
  middlewares.push(...(options.middleware ?? []));
  middlewares.push(createBudgetMiddleware());
  if (options.hil !== false) {
    middlewares.push(createHILMiddleware(options.hil ?? {}));
  }
  return middlewares;
}

export function createRuntimeDefaultMiddlewares(input: {
  options: CodaraRuntimeOptions;
  runtimeTools: StructuredToolInterface[];
  taskStore: TaskStore;
  logging: false | LoggingMiddlewareOptions;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  promptSource: PromptSource;
  guidelinesSource: GuidelinesSource;
  hookPipeline?: HookPipeline;
}): BaseMiddleware[] {
  const callerMiddlewares = input.options.middleware ?? [];
  const byName = new Map<string, BaseMiddleware>();
  const providedToolNames = collectProvidedToolNames({
    tools: input.options.tools,
    middlewares: callerMiddlewares,
  });
  for (const middleware of callerMiddlewares) {
    byName.set(middleware.name, middleware);
  }

  // GuidelinesMiddleware — lazy loading of subdirectory AGENTS.md / codara.md
  if (!byName.has(MIDDLEWARE_NAMES.Guidelines)) {
    byName.set(MIDDLEWARE_NAMES.Guidelines, createGuidelinesMiddleware({
      guidelinesSource: input.guidelinesSource,
      promptSource: input.promptSource,
    }));
  }

  if (!byName.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    byName.set(MIDDLEWARE_NAMES.TodoList, createTodoListMiddleware());
  }

  if (!byName.has(MIDDLEWARE_NAMES.SharedTask) && !hasSharedTaskTools(providedToolNames)) {
    byName.set(MIDDLEWARE_NAMES.SharedTask, createSharedTaskMiddleware({store: input.taskStore}));
  }

  if (!byName.has(MIDDLEWARE_NAMES.Task) && !providedToolNames.has('Task')) {
    byName.set(MIDDLEWARE_NAMES.Task, createTaskMiddleware({
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
    }));
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    byName.set(MIDDLEWARE_NAMES.AskUserQuestion, createAskUserQuestionMiddleware());
  }

  if (input.options.hil !== false && !byName.has(MIDDLEWARE_NAMES.Permission)) {
    byName.set(MIDDLEWARE_NAMES.Permission, createPermissionMiddleware({
      ...(typeof input.options.hil === 'object' && input.options.hil !== null ? input.options.hil : {}),
      cwd: input.options.cwd,
      projectRoot: input.options.projectRoot,
      userHome: input.options.userHome,
      bashAnalysisModel: createRuntimePermissionAnalysisModel(input.options, input.catalog),
    }));
  }

  // Add ToolHooksMiddleware after Permission (last in the chain)
  if (input.hookPipeline) {
    byName.set(MIDDLEWARE_NAMES.ToolHooks, createToolHooksMiddleware(input.hookPipeline));
  }

  return [...byName.values()];
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
    .filter((middleware) => middleware.name !== MIDDLEWARE_NAMES.Task);
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
  if (!seen.has(MIDDLEWARE_NAMES.SharedTask) && !hasSharedTaskTools(providedToolNames)) {
    push(createSharedTaskMiddleware({store: input.taskStore}));
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

function hasSharedTaskTools(toolNames: ReadonlySet<string>): boolean {
  return toolNames.has('TaskCreate') || toolNames.has('TaskUpdate') || toolNames.has('TaskList');
}

export function createInstructionContextPreparer(sources: {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
}): AgentContextPreparer | undefined {
  if (!sources.promptSource && !sources.guidelinesSource) {
    return undefined;
  }

  return async (context) => {
    const next = await buildBaseSystemMessage(sources.promptSource, sources.guidelinesSource);
    applyPreparedInstructionContext(context, next);
  };
}

function createRuntimePermissionAnalysisModel(
  options: Pick<CodaraRuntimeOptions, 'alias' | 'config' | 'model'>,
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>,
) {
  if (options.model) {
    return typeof options.model === 'function'
      ? options.model as () => Promise<BaseChatModel>
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

import {createMiddleware, type BaseMiddleware, MIDDLEWARE_NAMES} from '@core/pipeline-types';
import {
  createAskUserQuestionMiddleware,
  createBudgetMiddleware,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createTodoListMiddleware,
  type ReviewMiddlewareOptions,
  type LoggingMiddlewareOptions,
} from '@core/middleware';
import type {PermissionMiddlewareOptions} from '@core/middleware/permission/middleware';
import {createSubagentCatalogMessage, readSkillsRuntimeData} from '@capability/skill';
import {createSubagentRunManager} from '@capability/subagent/run-manager';
import {createSubagentRunMemoryStore} from '@capability/subagent/run-store';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createTaskTools} from '@capability/task/tools';
import type {TaskStore} from '@capability/task/types';
import {createMemoryWriteTool, createMemoryReadTool, createMemoryListTool} from '@capability/memory/tool';
import type {MemoryWriter} from '@capability/memory/writer';
import type {MemoryReader} from '@capability/memory/reader';
import {
  AGENT_TOOL_NAME,
  createSubagentTool,
  type CreateSubagentToolOptions,
} from '@capability/subagent/tool';
import {
  buildSubagentCompletionHandoff,
  maybeHandleSubagentCompletionToolCall,
} from '@capability/subagent/completion';

const subagentMiddlewareOptions = new WeakMap<BaseMiddleware, CreateSubagentMiddlewareOptions>();

export interface SubagentChildRuntimeOptions {
  interactionMode?: 'foreground' | 'background';
  logging?: false | LoggingMiddlewareOptions;
  review?: false | ReviewMiddlewareOptions;
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
}

export interface CreateSubagentMiddlewareOptions extends CreateSubagentToolOptions {
  name?: string;
  childRuntime?: SubagentChildRuntimeOptions;
  taskStore?: TaskStore;
  memoryWriter?: MemoryWriter;
  memoryReader?: MemoryReader;
}

export function createSubagentMiddleware(options: CreateSubagentMiddlewareOptions): BaseMiddleware {
  const runStore = options.runStore ?? createSubagentRunMemoryStore();
  const runManager = options.runManager ?? createSubagentRunManager({
    runStore,
    approvalStore: options.approvalStore,
  });
  const childMiddlewares = buildSubagentChildMiddlewares(options);
  const taskTools = options.taskStore ? createTaskTools({store: options.taskStore}) : [];
  const memoryTools = [
    ...(options.memoryWriter ? [createMemoryWriteTool({writer: options.memoryWriter})] : []),
    ...(options.memoryReader ? [createMemoryReadTool({reader: options.memoryReader}), createMemoryListTool({reader: options.memoryReader})] : []),
  ];

  const middleware = createMiddleware({
    name: options.name?.trim() || MIDDLEWARE_NAMES.Agent,
    tools: [
      ...taskTools,
      ...memoryTools,
      createSubagentTool({...options, runStore, runManager, childMiddleware: childMiddlewares}),
    ],
    beforeModel(context) {
      const completionHandoff = buildSubagentCompletionHandoff(context);
      if (completionHandoff) {
        context.systemMessage.push(completionHandoff);
      }

      const definitions = createSubagentCatalogMessage(readSkillsRuntimeData(context.runtime.shared));
      if (definitions) {
        context.systemMessage.push(definitions);
      }

      return undefined;
    },
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleSubagentCompletionToolCall(context);
      if (blocked) {
        return blocked;
      }

      return await handler(context);
    },
  });

  subagentMiddlewareOptions.set(middleware, {...options});

  return middleware;
}

export function readSubagentMiddlewareOptions(middleware: BaseMiddleware): CreateSubagentMiddlewareOptions | undefined {
  return subagentMiddlewareOptions.get(middleware);
}

export function applyRuntimeSubagentDefaults(
  middleware: BaseMiddleware,
  runtimeMiddleware: BaseMiddleware,
): BaseMiddleware {
  if (middleware.name !== MIDDLEWARE_NAMES.Agent) {
    return middleware;
  }

  const options = readSubagentMiddlewareOptions(middleware);
  const runtimeDefaults = readSubagentMiddlewareOptions(runtimeMiddleware);
  if (!options || !runtimeDefaults) {
    return middleware;
  }

  return createSubagentMiddleware({
    ...runtimeDefaults,
    ...options,
    taskStore: runtimeDefaults.taskStore,
    memoryWriter: runtimeDefaults.memoryWriter,
    memoryReader: runtimeDefaults.memoryReader,
    runStore: 'runStore' in options ? options.runStore : runtimeDefaults.runStore,
    runManager: 'runManager' in options ? options.runManager : runtimeDefaults.runManager,
    checkpointer: runtimeDefaults.checkpointer,
    approvalStore: runtimeDefaults.approvalStore,
    model: options.model ?? runtimeDefaults.model,
    tools: options.tools ?? runtimeDefaults.tools,
    childRuntime: {
      ...(runtimeDefaults.childRuntime ?? {}),
      ...(options.childRuntime ?? {}),
    },
    childMiddleware: options.childMiddleware ?? runtimeDefaults.childMiddleware,
    childInstructionContext: 'childInstructionContext' in options ? options.childInstructionContext : runtimeDefaults.childInstructionContext,
    childLifecycle: options.childLifecycle ?? runtimeDefaults.childLifecycle,
  });
}

export function assertNoRawSubagentTools(tools: StructuredToolInterface[] | undefined): void {
  const hasRawAgentTool = (tools ?? []).some((tool) => tool?.name === AGENT_TOOL_NAME);
  if (!hasRawAgentTool) {
    return;
  }

  throw new Error(
    'Codara runtime does not accept raw Agent tools in options.tools. '
    + 'Register subagent delegation through createSubagentMiddleware() instead.',
  );
}

export function buildSubagentChildMiddlewares(options: CreateSubagentMiddlewareOptions): BaseMiddleware[] {
  return assembleSubagentChildMiddlewares(options);
}

function assembleSubagentChildMiddlewares(options: CreateSubagentMiddlewareOptions): BaseMiddleware[] {
  const middlewares: BaseMiddleware[] = [];
  const callerMiddlewares = [...(options.childMiddleware ?? [])];
  const providedToolNames = collectProvidedToolNames({
    tools: options.tools,
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

  const isForegroundInteractive = options.childRuntime?.interactionMode === 'foreground';

  if (options.childRuntime?.logging && options.childRuntime.logging.enabled !== false) {
    push(createLoggingMiddleware(options.childRuntime.logging));
  }

  for (const middleware of callerMiddlewares) {
    push(middleware);
  }

  if (!seen.has(MIDDLEWARE_NAMES.TodoList) && !providedToolNames.has('write_todos')) {
    push(createTodoListMiddleware());
  }
  if (isForegroundInteractive && options.childRuntime?.review !== false && !seen.has(MIDDLEWARE_NAMES.AskUserQuestion)) {
    push(createAskUserQuestionMiddleware());
  }
  if (options.childRuntime?.review !== false && !seen.has(MIDDLEWARE_NAMES.Permission)) {
    const permissionOptions: PermissionMiddlewareOptions = {
      ...(typeof options.childRuntime?.review === 'object' && options.childRuntime.review !== null
        ? options.childRuntime.review
        : {}),
      cwd: options.childRuntime?.cwd,
      projectRoot: options.childRuntime?.projectRoot,
      userHome: options.childRuntime?.userHome,
    };
    push(createPermissionMiddleware(permissionOptions));
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

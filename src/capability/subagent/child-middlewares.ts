import {
  createAskUserQuestionMiddleware,
  createBudgetMiddleware,
  type ReviewMiddlewareOptions,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createTodoListMiddleware,
  type LoggingMiddlewareOptions,
} from '@core/middleware';
import {MIDDLEWARE_NAMES, type BaseMiddleware} from '@core/pipeline/types';
import type {PermissionAnalysisModel} from '@core/middleware/permission/analysis';
import type {PermissionMiddlewareOptions} from '@core/middleware/permission/middleware';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {CreateAgentToolOptions} from '@capability/subagent/tool';

export interface AgentChildRuntimeOptions {
  interactionMode?: 'foreground' | 'background';
  logging?: false | LoggingMiddlewareOptions;
  review?: false | ReviewMiddlewareOptions;
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  permissionAnalysisModel?: PermissionAnalysisModel | Promise<PermissionAnalysisModel> | (() => Promise<PermissionAnalysisModel>);
}

export interface BuildAgentChildMiddlewaresOptions extends CreateAgentToolOptions {
  childRuntime?: AgentChildRuntimeOptions;
}

export function buildAgentChildMiddlewares(options: BuildAgentChildMiddlewaresOptions): BaseMiddleware[] {
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
      bashAnalysisModel: options.childRuntime?.permissionAnalysisModel,
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

import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import {
  createTaskTools,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  type TaskToolOptions,
} from '@core/tasks/tools';

export {
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
};

export interface CreateSharedTaskMiddlewareOptions extends TaskToolOptions {
  name?: string;
}

export function createSharedTaskMiddleware(options: CreateSharedTaskMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'SharedTaskMiddleware',
    tools: createTaskTools(options),
  });
}

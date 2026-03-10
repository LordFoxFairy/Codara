import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import {
  createTaskTool,
  TASK_TOOL_DESCRIPTION,
  TASK_TOOL_NAME,
  type CreateTaskToolOptions,
} from '@core/agents/task-tool';

export {
  TASK_TOOL_DESCRIPTION,
  TASK_TOOL_NAME,
};

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  name?: string;
}

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: [createTaskTool(options)],
  });
}

import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {createTaskTools, type TaskToolOptions} from './tools';

export interface CreateTaskMiddlewareOptions extends TaskToolOptions {
  name?: string;
}

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: createTaskTools({store: options.store}),
  });
}

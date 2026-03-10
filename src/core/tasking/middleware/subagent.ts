import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import {
  createSubagentTool,
  DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
  DEFAULT_SUBAGENT_TOOL_NAME,
  type CreateSubagentToolOptions,
} from '@core/tasking/subagent';

export {
  DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
  DEFAULT_SUBAGENT_TOOL_NAME,
};

export interface CreateSubagentMiddlewareOptions extends CreateSubagentToolOptions {
  name?: string;
}

export function createSubagentMiddleware(options: CreateSubagentMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'SubagentMiddleware',
    tools: [createSubagentTool(options)],
  });
}

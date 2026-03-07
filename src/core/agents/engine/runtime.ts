import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';
import {MiddlewarePipeline} from '@core/middleware';
import type {CreateAgentOptions} from '../contract/agent';
import type {AgentRuntime} from '../loop/run';
import {buildAgentModel} from './model';

/** 组装 agent 运行时依赖。 */
export function buildAgentRuntime(options: CreateAgentOptions): AgentRuntime {
  const {model, tools = [], handleToolErrors = true} = options;
  const middleware = resolveMiddleware(options);

  return {
    model: buildAgentModel(model, tools),
    tools: buildToolRegistry(tools),
    pipeline: new MiddlewarePipeline(middleware),
    handleToolErrors,
  };
}

function resolveMiddleware(options: CreateAgentOptions): BaseMiddleware[] {
  if (options.middleware?.length) {
    return [...options.middleware];
  }

  if (options.middlewares?.length) {
    return [...options.middlewares];
  }

  return [];
}

function buildToolRegistry(tools: StructuredToolInterface[]): Map<string, StructuredToolInterface> {
  const registry = new Map<string, StructuredToolInterface>();

  for (const tool of tools) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  return registry;
}

import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';
import {MiddlewarePipeline} from '@core/middleware';
import type {CreateAgentOptions} from '@core/agents/contract/agent';
import type {AgentRuntime} from '@core/agents/loop/run';
import {buildAgentModel} from '@core/agents/engine/model';

/** 组装 agent 运行时依赖。 */
export function buildAgentRuntime(options: CreateAgentOptions): AgentRuntime {
  const {model, handleToolErrors = true} = options;
  const middleware = resolveMiddleware(options);
  const pipeline = new MiddlewarePipeline(middleware);
  const tools = resolveTools(options.tools ?? [], pipeline);

  return {
    model: buildAgentModel(model, tools),
    tools: buildToolRegistry(tools),
    pipeline,
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

function resolveTools(
  baseTools: StructuredToolInterface[],
  pipeline: MiddlewarePipeline
): StructuredToolInterface[] {
  const allTools = [...baseTools, ...pipeline.getTools()];
  const seen = new Set<string>();

  for (const tool of allTools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    seen.add(tool.name);
  }

  return allTools;
}

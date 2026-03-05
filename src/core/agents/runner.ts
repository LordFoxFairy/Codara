import {AIMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentInvokeConfig, AgentResult, AgentRunnerParams, AgentState} from '@core/agents/types';
import {
  afterRun,
  beforeRun,
  createAgentRuntime,
  runAgentLoop,
  type AgentModel,
  type LoopExecutionDeps
} from '@core/agents/runtime';
import {createAgentResult, toError} from '@core/agents/runtime/shared/common';
import {MiddlewarePipeline} from '@core/middleware';

/**
 * Agent 调度入口。
 * - 装配 model/tools/middleware
 * - 编排 beforeRun -> loop -> afterRun
 */
export class AgentRunner {
  private readonly loopDeps: LoopExecutionDeps;

  constructor(params: AgentRunnerParams) {
    this.loopDeps = createLoopExecutionDeps(params);
  }

  async invoke(state: AgentState, config?: AgentInvokeConfig): Promise<AgentResult> {
    const runtime = createAgentRuntime(state, config);

    try {
      this.loopDeps.pipeline.validateContext(runtime.context);
    } catch (error) {
      return createAgentResult(state, 0, 'error', new Error(`context validation failed: ${toError(error).message}`));
    }

    const beforeRunResult = await beforeRun(runtime, config);
    if (beforeRunResult) {
      return beforeRunResult;
    }

    const loopResult = await runAgentLoop(runtime, this.loopDeps);
    return afterRun(runtime, loopResult, config);
  }
}

export function createAgentRunner(params: AgentRunnerParams): AgentRunner {
  return new AgentRunner(params);
}

/** 构造 loop 依赖（model/tools/pipeline）。 */
function createLoopExecutionDeps(params: AgentRunnerParams): LoopExecutionDeps {
  const {model, tools = [], handleToolErrors = true, middlewares = []} = params;

  const boundModel = createAgentModel(model, tools);
  const toolRegistry = createToolRegistry(tools);

  return {
    model: boundModel,
    tools: toolRegistry,
    pipeline: new MiddlewarePipeline(middlewares),
    handleToolErrors
  };
}

function createToolRegistry(tools: StructuredToolInterface[]): Map<string, StructuredToolInterface> {
  const toolRegistry = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    if (toolRegistry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    toolRegistry.set(tool.name, tool);
  }
  return toolRegistry;
}

function createAgentModel(model: AgentRunnerParams['model'], tools: StructuredToolInterface[]): AgentModel {
  const runnable = tools.length === 0 ? model : bindModelWithTools(model, tools);

  return {
    async invoke(messages: AgentState['messages']) {
      const message = await runnable.invoke(messages);
      if (!AIMessage.isInstance(message)) {
        throw new Error(`Model must return AIMessage, received: ${readMessageType(message)}`);
      }
      return message;
    }
  };
}

function bindModelWithTools(
  model: AgentRunnerParams['model'],
  tools: StructuredToolInterface[]
): {invoke: (messages: AgentState['messages']) => Promise<unknown>} {
  if (!('bindTools' in model) || typeof model.bindTools !== 'function') {
    throw new Error('Model does not support bindTools; cannot attach tools.');
  }

  return model.bindTools(tools);
}

function readMessageType(message: unknown): string {
  if (message && typeof message === 'object' && '_getType' in message && typeof message._getType === 'function') {
    return String(message._getType());
  }
  return typeof message;
}

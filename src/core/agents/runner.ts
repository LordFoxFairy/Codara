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
import {MiddlewarePipeline} from '@core/middleware';

/**
 * AgentRunner（门面层）
 * 责任：
 * 1. 依赖装配（model/tools/middleware）
 * 2. 外层 hooks 编排（beforeRun -> loop -> afterRun）
 * 3. 对外暴露单一 invoke 入口
 *
 * 非责任：
 * - 不承载 loop 内每轮细节（见 runtime/stages/turn-stage.ts）
 * - 不承载外层 hook 细节（见 runtime/hooks/agent-hooks.ts）
 */
export class AgentRunner {
  private readonly loopDeps: LoopExecutionDeps;

  constructor(params: AgentRunnerParams) {
    this.loopDeps = createLoopExecutionDeps(params);
  }

  /**
   * 调用链路：
   * 1) 创建运行时上下文
   * 2) 执行 invoke 外 beforeRun hook
   * 3) 执行 loop 主流程（每轮 middleware）
   * 4) 执行 invoke 外 afterRun hook
   */
  async invoke(state: AgentState, config?: AgentInvokeConfig): Promise<AgentResult> {
    const runtime = createAgentRuntime(state, config);

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

/** 装配 loop 运行依赖（模型、工具表、中间件管道） */
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

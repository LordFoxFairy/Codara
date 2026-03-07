import {AIMessage, AIMessageChunk} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentInvokeConfig, AgentResult, AgentRunnerParams, AgentState} from '@core/agents/types';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/stream';
import type {BaseMiddleware} from '@core/middleware';
import {
  afterRun,
  beforeRun,
  createAgentRuntime,
  runAgentLoop,
  runAgentLoopStream,
  type AgentModel,
  type LoopExecutionDeps
} from '@core/agents/runtime';
import {createAgentResult, toError} from '@core/agents/runtime/shared/common';
import {createStreamController} from '@core/agents/runtime/stream';
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

  async *stream(
    state: AgentState,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
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

    const stream = createStreamController(config);
    const execution = (async () => {
      await stream.emitValues(runtime.state.messages);
      const loopResult = await runAgentLoopStream(runtime, this.loopDeps, stream);
      const result = await afterRun(runtime, loopResult, config);
      stream.finish(result);
      return result;
    })().catch((error) => {
      stream.fail(error);
      throw error;
    });

    try {
      while (true) {
        const next = await stream.stream.next();
        if (next.done) {
          return next.value;
        }
        yield next.value;
      }
    } finally {
      await execution.catch(() => undefined);
    }
  }
}

export function createAgentRunner(params: AgentRunnerParams): AgentRunner {
  return new AgentRunner(params);
}

/** 构造 loop 依赖（model/tools/pipeline）。 */
function createLoopExecutionDeps(params: AgentRunnerParams): LoopExecutionDeps {
  const {model, tools = [], handleToolErrors = true} = params;
  const middlewares = resolveMiddlewares(params);

  const boundModel = createAgentModel(model, tools);
  const toolRegistry = createToolRegistry(tools);

  return {
    model: boundModel,
    tools: toolRegistry,
    pipeline: new MiddlewarePipeline(middlewares),
    handleToolErrors
  };
}

function resolveMiddlewares(params: AgentRunnerParams): BaseMiddleware[] {
  if (params.middlewares?.length) {
    return [...params.middlewares];
  }

  if (params.middleware?.length) {
    return [...params.middleware];
  }

  return [];
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
    },
    async *stream(messages: AgentState['messages']) {
      if ('stream' in runnable && typeof runnable.stream === 'function') {
        const iterable = await runnable.stream(messages);
        for await (const message of iterable) {
          yield normalizeStreamChunk(message);
        }
        return;
      }

      const fallback = await runnable.invoke(messages);
      if (!AIMessage.isInstance(fallback)) {
        throw new Error(`Model must return AIMessage, received: ${readMessageType(fallback)}`);
      }
      yield normalizeStreamChunk(fallback);
    },
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

function normalizeStreamChunk(message: unknown): AIMessageChunk {
  if (AIMessageChunk.isInstance(message)) {
    return message;
  }

  if (!AIMessage.isInstance(message)) {
    throw new Error(`Model stream must yield AIMessage or AIMessageChunk, received: ${readMessageType(message)}`);
  }

  return new AIMessageChunk({
    content: message.content,
    ...(message.id ? {id: message.id} : {}),
    ...(message.name ? {name: message.name} : {}),
    ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
    ...(message.invalid_tool_calls ? {invalid_tool_calls: message.invalid_tool_calls} : {}),
    ...(message.usage_metadata ? {usage_metadata: message.usage_metadata} : {}),
    ...(message.additional_kwargs ? {additional_kwargs: message.additional_kwargs} : {}),
    ...(message.response_metadata ? {response_metadata: message.response_metadata} : {}),
  });
}

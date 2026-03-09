import type {ToolCall} from '@langchain/core/messages';
import type {AgentRunSummary, BaseExecutionContext, ToolCallContext} from '@core/middleware';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {executeToolCall, resolveToolCallId} from '@core/agents/engine/tools';
import type {AgentRuntime, AgentRunContext} from '@core/agents/loop/run';

export async function runToolStep(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[]
): Promise<void> {
  const pipeline = runtime.pipeline;

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
    const toolCall = toolCalls[toolIndex];
    const toolCallId = resolveToolCallId(toolCall, toolIndex);
    const tool = runtime.tools.get(toolCall.name);
    const toolContext = createToolContext(context, toolCall, toolIndex, toolCallId, tool);

    const toolMessage = await pipeline.wrapToolCall(toolContext, (request?: ToolCallContext) => {
      const nextCall = request?.toolCall ?? toolCall;
      const nextIndex = request?.toolIndex ?? toolIndex;
      const nextTool = request?.tool ?? runtime.tools.get(nextCall.name);
      const nextToolCallId = resolveToolCallId(nextCall, nextIndex);
      return executeToolCall(
        nextCall,
        nextToolCallId,
        nextTool,
        runtime.handleToolErrors,
        run.state,
        request?.runtime.context ?? context.runtime.context,
        (values) => runtime.pipeline.normalizeValues(values ?? {})
      );
    });

    run.state.messages.push(toolMessage);
  }
}

export async function runToolStepStream(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  stream: AgentStreamWriter
): Promise<void> {
  const pipeline = runtime.pipeline;

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
    const toolCall = toolCalls[toolIndex];
    const toolCallId = resolveToolCallId(toolCall, toolIndex);
    const tool = runtime.tools.get(toolCall.name);
    const toolContext = createToolContext(context, toolCall, toolIndex, toolCallId, tool);

    const toolMessage = await pipeline.wrapToolCall(toolContext, (request?: ToolCallContext) => {
      const nextCall = request?.toolCall ?? toolCall;
      const nextIndex = request?.toolIndex ?? toolIndex;
      const nextTool = request?.tool ?? runtime.tools.get(nextCall.name);
      const nextToolCallId = resolveToolCallId(nextCall, nextIndex);
      return executeToolCall(
        nextCall,
        nextToolCallId,
        nextTool,
        runtime.handleToolErrors,
        run.state,
        request?.runtime.context ?? context.runtime.context,
        (values) => runtime.pipeline.normalizeValues(values ?? {})
      );
    });

    run.state.messages.push(toolMessage);
    await stream.emitToolUpdate(toolMessage);
    await stream.emitValues(run.state.messages);

    const payload = parseHILToolMessagePayload(toolMessage.content);
    if (payload) {
      await stream.emitCustom({runId: context.runId, turn: context.turn, payload});
    }
  }
}

export async function runAfterAgentStep(
  pipeline: AgentRuntime['pipeline'],
  context: BaseExecutionContext,
  result: AgentRunSummary
): Promise<void> {
  try {
    await pipeline.afterAgent({...context, result});
  } catch (error) {
    if (!result.error) {
      throw toError(error);
    }
  }
}

function createToolContext(
  context: BaseExecutionContext,
  toolCall: ToolCall,
  toolIndex: number,
  toolCallId: string,
  tool: ToolCallContext['tool']
): ToolCallContext {
  return {
    ...context,
    requestId: `${context.requestId}:tool:${toolCallId}`,
    toolCall,
    toolIndex,
    tool,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

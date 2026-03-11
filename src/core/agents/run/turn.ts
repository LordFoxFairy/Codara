import {AIMessage, SystemMessage, type ToolCall} from '@langchain/core/messages';
import {executeToolCall, resolveToolCallId} from './tool-executor';
import type {AgentStreamWriter} from './stream';
import {
  chunkToMessage,
  createTurnContext,
  toMessageChunk,
  type AgentRunContext,
  type AgentRuntime,
} from './agent-loop';
import {
  readExecutionMetadata,
  type AgentRunSummary,
  type BaseExecutionContext,
  type ModelCallContext,
  type ToolCallContext,
} from '@core/middleware';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {toError} from '@core/support/errors';

export type AgentTurnOutcome = 'continue' | 'complete';

export async function runAgentTurn(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  stream?: AgentStreamWriter,
): Promise<AgentTurnOutcome> {
  const context = await createTurnContext(run, runtime, turn, `${run.runId}:turn:${turn}`);
  let result: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    const response = await runModel(runtime, context, stream);
    run.state.messages.push(response);
    if (stream) {
      await stream.emitModelUpdate(response);
      await stream.emitValues(run.state.messages);
    }

    await runtime.pipeline.afterModel({...context, response});
    if (!response.tool_calls?.length) {
      result = {reason: 'complete', turns: turn};
    } else {
      await runTools(run, runtime, context, response.tool_calls, stream);
      if (run.state.pendingPause) {
        result = {reason: 'complete', turns: turn};
      }
    }
  } catch (error) {
    result = {reason: 'error', turns: turn, error: toError(error)};
  }

  await finishTurn(runtime, context, result);
  if (result.error) {
    throw result.error;
  }
  return result.reason === 'complete' ? 'complete' : 'continue';
}

async function runModel(
  runtime: AgentRuntime,
  context: ModelCallContext,
  stream?: AgentStreamWriter,
): Promise<AIMessage> {
  return runtime.pipeline.wrapModelCall(context, async (request = context) => {
    const modelMessages = [...request.systemMessage.map((content) => new SystemMessage(content)), ...request.messages];
    if (!stream) {
      return await runtime.model.invoke(modelMessages);
    }

    const execution = readExecutionMetadata(request);
    let aggregate;
    for await (const chunk of runtime.model.stream(modelMessages)) {
      const normalized = toMessageChunk(chunk);
      aggregate = aggregate ? aggregate.concat(normalized) : normalized;
      await stream.emitMessages({
        runId: execution.runId,
        threadId: execution.threadId,
        requestId: execution.requestId,
        turn: execution.turn,
        chunk: normalized,
      });
    }

    return aggregate ? chunkToMessage(aggregate) : new AIMessage('');
  });
}

async function runTools(
  run: AgentRunContext,
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  toolCalls: ToolCall[],
  stream?: AgentStreamWriter,
): Promise<void> {
  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
    const toolCall = toolCalls[toolIndex] as ToolCall;
    const toolCallId = resolveToolCallId(toolCall, toolIndex);
    const tool = runtime.tools.get(toolCall.name);
    const baseExecution = {
      ...readExecutionMetadata(context),
      requestId: `${readExecutionMetadata(context).requestId}:tool:${toolCallId}`,
      toolIndex,
      toolCallId,
    };

    const toolMessage = await runtime.pipeline.wrapToolCall({
      ...context,
      execution: baseExecution,
      toolCall,
      toolIndex,
      tool,
    }, (request?: ToolCallContext) => {
      const nextCall = request?.toolCall ?? toolCall;
      const nextIndex = request?.toolIndex ?? toolIndex;
      const nextToolCallId = resolveToolCallId(nextCall, nextIndex);
      return executeToolCall(
        nextCall,
        nextToolCallId,
        request?.tool ?? runtime.tools.get(nextCall.name),
        runtime.handleToolErrors,
        run.state,
        {
          ...(request?.runtime ?? context.runtime),
          execution: request?.execution ?? {...baseExecution, toolIndex: nextIndex, toolCallId: nextToolCallId},
        },
        (values) => runtime.pipeline.normalizeValues(values ?? {}),
      );
    });

    run.state.messages.push(toolMessage);
    if (stream) {
      await stream.emitToolUpdate(toolMessage);
      await stream.emitValues(run.state.messages);
      const payload = parseHILToolMessagePayload(toolMessage.content);
      if (payload) {
        const execution = readExecutionMetadata(context);
        await stream.emitCustom({runId: execution.runId, turn: execution.turn, payload});
      }
    }

    const pausePayload = parseHILToolMessagePayload(toolMessage.content);
    if (pausePayload?.type === 'hil_pause') {
      run.state.pendingPause = pausePayload.request;
      return;
    }
  }
}

async function finishTurn(
  runtime: AgentRuntime,
  context: BaseExecutionContext,
  result: AgentRunSummary,
): Promise<void> {
  try {
    await runtime.pipeline.afterAgent({...context, result});
  } catch (error) {
    if (!result.error) {
      throw toError(error);
    }
  }
}

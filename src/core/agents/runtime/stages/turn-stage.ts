import type {ToolCall} from '@langchain/core/messages';
import type {AgentRunSummary, BaseExecutionContext} from '@core/middleware';
import {resolveToolCallId, toError} from '@core/agents/runtime/shared/common';
import type {AgentLoopRuntime, LoopExecutionDeps} from '@core/agents/runtime/shared/contracts';
import {createTurnContext} from '@core/agents/runtime/context/runtime-context';
import {invokeTool} from '@core/agents/runtime/stages/tool-stage';

export type TurnOutcome = 'continue' | 'complete';

/**
 * 单轮执行（6 个 middleware hooks 全链）：
 * beforeAgent -> beforeModel -> wrapModelCall -> afterModel -> wrapToolCall* -> afterAgent
 */
export async function runTurn(
  runtime: AgentLoopRuntime,
  deps: LoopExecutionDeps,
  turn: number
): Promise<TurnOutcome> {
  const context = createTurnContext(runtime, turn);
  const pipeline = deps.pipeline;
  let turnResult: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    // 1) beforeAgent
    await pipeline.beforeAgent(context);
    // 2) beforeModel
    await pipeline.beforeModel(context);

    // 3) wrapModelCall
    const invokeModel = () => deps.model.invoke(runtime.state.messages);
    const modelMessage = await pipeline.wrapModelCall(context, invokeModel);
    runtime.state.messages.push(modelMessage);

    // 4) afterModel
    await pipeline.afterModel({...context, response: modelMessage});

    if (!modelMessage.tool_calls?.length) {
      turnResult = {reason: 'complete', turns: turn};
    } else {
      // 5) wrapToolCall (per tool_call)
      await wrapToolCalls(runtime, deps, context, modelMessage.tool_calls);
    }
  } catch (error) {
    turnResult = {reason: 'error', turns: turn, error: toError(error)};
  }

  // 6) afterAgent
  await afterAgent(pipeline, context, turnResult);

  if (turnResult.error) {
    throw turnResult.error;
  }

  return turnResult.reason === 'complete' ? 'complete' : 'continue';
}

async function wrapToolCalls(
  runtime: AgentLoopRuntime,
  deps: LoopExecutionDeps,
  context: BaseExecutionContext,
  toolCalls: ToolCall[]
): Promise<void> {
  const pipeline = deps.pipeline;

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
    const toolCall = toolCalls[toolIndex];
    const toolCallId = resolveToolCallId(toolCall, toolIndex);
    const tool = deps.tools.get(toolCall.name);

    const toolMessage = await pipeline.wrapToolCall(
      {
        ...context,
        requestId: `${context.requestId}:tool:${toolCallId}`,
        toolCall,
        toolIndex,
        tool
      },
      () => invokeTool(toolCall, toolCallId, tool, deps.handleToolErrors)
    );

    runtime.state.messages.push(toolMessage);
  }
}

async function afterAgent(
  pipeline: LoopExecutionDeps['pipeline'],
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

import type {AgentRunSummary, BaseExecutionContext} from '@core/middleware';
import type {AgentRunContext, AgentRuntime} from '@core/agents/loop/run';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {runModelStep, runModelStepStream} from '@core/agents/loop/model-step';
import {runAfterAgentStep, runToolStep, runToolStepStream} from '@core/agents/loop/tool-step';

export type AgentTurnOutcome = 'continue' | 'complete';

/** 执行一轮非流式 turn。 */
export async function runTurn(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number
): Promise<AgentTurnOutcome> {
  const context = createTurnContext(run, turn);
  const pipeline = runtime.pipeline;
  let turnResult: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    await pipeline.beforeAgent(context);
    await pipeline.beforeModel(context);

    const modelMessage = await runModelStep(runtime, context);
    run.state.messages.push(modelMessage);

    await pipeline.afterModel({...context, response: modelMessage});

    if (!modelMessage.tool_calls?.length) {
      turnResult = {reason: 'complete', turns: turn};
    } else {
      await runToolStep(run, runtime, context, modelMessage.tool_calls);
    }
  } catch (error) {
    turnResult = {reason: 'error', turns: turn, error: toError(error)};
  }

  await runAfterAgentStep(pipeline, context, turnResult);

  if (turnResult.error) {
    throw turnResult.error;
  }

  return turnResult.reason === 'complete' ? 'complete' : 'continue';
}

/** 执行一轮流式 turn。 */
export async function runTurnStream(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  stream: AgentStreamWriter
): Promise<AgentTurnOutcome> {
  const context = createTurnContext(run, turn);
  const pipeline = runtime.pipeline;
  let turnResult: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    await pipeline.beforeAgent(context);
    await pipeline.beforeModel(context);

    const modelMessage = await runModelStepStream(runtime, run, context, stream);
    run.state.messages.push(modelMessage);
    await stream.emitModelUpdate(modelMessage);
    await stream.emitValues(run.state.messages);

    await pipeline.afterModel({...context, response: modelMessage});

    if (!modelMessage.tool_calls?.length) {
      turnResult = {reason: 'complete', turns: turn};
    } else {
      await runToolStepStream(run, runtime, context, modelMessage.tool_calls, stream);
    }
  } catch (error) {
    turnResult = {reason: 'error', turns: turn, error: toError(error)};
  }

  await runAfterAgentStep(pipeline, context, turnResult);

  if (turnResult.error) {
    throw turnResult.error;
  }

  return turnResult.reason === 'complete' ? 'complete' : 'continue';
}

function createTurnContext(run: AgentRunContext, turn: number): BaseExecutionContext {
  return {
    state: run.state,
    messages: run.state.messages,
    runtime: {context: run.context, agentContext: run.agentContext},
    systemMessage: [],
    runId: run.runId,
    turn,
    maxTurns: run.maxTurns,
    requestId: `${run.runId}:turn:${turn}`,
    inputBudget: run.inputBudget,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

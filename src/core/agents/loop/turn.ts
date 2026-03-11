import {
  runBeforeModelStage,
  type AgentRunContext,
  type AgentRuntime,
} from '@core/agents/loop/run';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {runModelStep, runModelStepStream} from '@core/agents/loop/model-step';
import {runAfterAgentStep, runToolStep, runToolStepStream} from '@core/agents/loop/tool-step';
import {toError} from '@core/shared/errors';
import type {AIMessage, ToolCall} from '@langchain/core/messages';
import type {AgentRunSummary, BaseExecutionContext} from '@core/middleware';

export type AgentTurnOutcome = 'continue' | 'complete';

/** Turn 执行策略接口 */
interface TurnExecutionStrategy {
  executeModel(runtime: AgentRuntime, run: AgentRunContext, context: BaseExecutionContext): Promise<AIMessage>;
  afterModelMessage(message: AIMessage, run: AgentRunContext): Promise<void>;
  executeTools(run: AgentRunContext, runtime: AgentRuntime, context: BaseExecutionContext, toolCalls: ToolCall[]): Promise<void>;
}

/** 非流式执行策略 */
class NonStreamStrategy implements TurnExecutionStrategy {
  async executeModel(runtime: AgentRuntime, contextRun: AgentRunContext, context: BaseExecutionContext): Promise<AIMessage> {
    void contextRun;
    return runModelStep(runtime, context);
  }

  async afterModelMessage(): Promise<void> {
    // 非流式模式无需额外操作
  }

  async executeTools(run: AgentRunContext, runtime: AgentRuntime, context: BaseExecutionContext, toolCalls: ToolCall[]): Promise<void> {
    await runToolStep(run, runtime, context, toolCalls);
  }
}

/** 流式执行策略 */
class StreamStrategy implements TurnExecutionStrategy {
  constructor(private readonly stream: AgentStreamWriter) {}

  async executeModel(runtime: AgentRuntime, run: AgentRunContext, context: BaseExecutionContext): Promise<AIMessage> {
    return runModelStepStream(runtime, run, context, this.stream);
  }

  async afterModelMessage(message: AIMessage, run: AgentRunContext): Promise<void> {
    await this.stream.emitModelUpdate(message);
    await this.stream.emitValues(run.state.messages);
  }

  async executeTools(run: AgentRunContext, runtime: AgentRuntime, context: BaseExecutionContext, toolCalls: ToolCall[]): Promise<void> {
    await runToolStepStream(run, runtime, context, toolCalls, this.stream);
  }
}

/** 执行一轮非流式 turn。 */
export async function runTurn(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number
): Promise<AgentTurnOutcome> {
  return runTurnCore(run, runtime, turn, new NonStreamStrategy());
}

/** 执行一轮流式 turn。 */
export async function runTurnStream(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  stream: AgentStreamWriter
): Promise<AgentTurnOutcome> {
  return runTurnCore(run, runtime, turn, new StreamStrategy(stream));
}

/** 核心 turn 逻辑，由 runTurn 和 runTurnStream 共享。 */
async function runTurnCore(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  strategy: TurnExecutionStrategy
): Promise<AgentTurnOutcome> {
  const context = await runBeforeModelStage(run, runtime, turn, `${run.runId}:turn:${turn}`);
  const pipeline = runtime.pipeline;
  let turnResult: AgentRunSummary = {reason: 'continue', turns: turn};

  try {
    const modelMessage = await strategy.executeModel(runtime, run, context);
    run.state.messages.push(modelMessage);
    await strategy.afterModelMessage(modelMessage, run);

    await pipeline.afterModel({...context, response: modelMessage});

    if (!modelMessage.tool_calls?.length) {
      turnResult = {reason: 'complete', turns: turn};
    } else {
      await strategy.executeTools(run, runtime, context, modelMessage.tool_calls);
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

import {randomUUID} from 'node:crypto';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentState,
  AgentTurnContextPreparer,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {AgentModel} from '@core/agents/engine/runtime';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {readLatestPause} from '@core/agents/engine/runtime-input';
import {runModelStep, runModelStepStream} from '@core/agents/loop/model-step';
import {runAfterAgentStep, runToolStep, runToolStepStream} from '@core/agents/loop/tool-step';
import type {AgentRunSummary, BaseExecutionContext, MiddlewareRuntimeShared} from '@core/middleware';
import type {MiddlewarePipeline} from '@core/middleware/pipeline';
import {deepClone} from '@core/support/clone';
import {toError, formatErrorMessage} from '@core/support/errors';
import {mergeContext} from '@core/agents/engine/runtime-input';
import type {AIMessage, ToolCall} from '@langchain/core/messages';

const DEFAULT_RECURSION_LIMIT = 25;

/** 单次运行期间共享的上下文。 */
export interface AgentRunContext {
  state: AgentState;
  runId: string;
  maxTurns: number;
  /** 临时运行时上下文（仅本次 invoke 有效，不持久化） */
  runtimeContext: AgentRuntimeContext;
  /** 运行时共享状态（middleware 间共享，不持久化） */
  shared: MiddlewareRuntimeShared;
  inputBudget?: AgentInputBudget;
}

/** Agent 运行依赖。 */
export interface AgentRuntime {
  model: AgentModel;
  tools: Map<string, StructuredToolInterface>;
  pipeline: MiddlewarePipeline;
  handleToolErrors: ToolErrorHandler;
  prepareTurnContext?: AgentTurnContextPreparer;
}

/** 为 invoke/stream 创建运行上下文。 */
export function createRunContext(
  state: AgentState,
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget'> = {}
): AgentRunContext {
  return {
    state,
    runId: randomUUID(),
    maxTurns: normalizeMaxTurns(config.recursionLimit),
    runtimeContext: deepClone(config.context ?? {}),
    shared: {},
    inputBudget: config.inputBudget,
  };
}

export function resolveEffectiveContext(run: Pick<AgentRunContext, 'state' | 'runtimeContext'>): AgentRuntimeContext {
  return mergeContext(run.state.context, run.runtimeContext);
}

export function createExecutionContext(
  run: AgentRunContext,
  turn: number,
  requestId: string
): BaseExecutionContext {
  const effectiveContext = resolveEffectiveContext(run);

  return {
    state: run.state,
    messages: run.state.messages,
    runtime: {
      context: effectiveContext,
      runtimeContext: run.runtimeContext,
      shared: run.shared,
    },
    systemMessage: [],
    execution: {
      threadId: run.state.threadId,
      runId: run.runId,
      turn,
      maxTurns: run.maxTurns,
      requestId,
    },
    inputBudget: run.inputBudget,
  };
}

/** 在主循环之外执行 beforeRun 钩子。 */
export async function runBeforeHook(
  run: AgentRunContext,
  config?: {beforeRun?: AgentInvokeConfig['beforeRun']}
): Promise<AgentResult | undefined> {
  if (!config?.beforeRun) {
    return undefined;
  }

  try {
    await config.beforeRun(toHookContext(run));
    return undefined;
  } catch (error) {
    return createAgentResult(run.state, 0, 'error', new Error(formatErrorMessage(error, 'beforeRun failed')));
  }
}

/** 在主循环外执行 afterRun hook。 */
export async function runAfterHook(
  run: AgentRunContext,
  result: AgentResult,
  config?: {afterRun?: AgentInvokeConfig['afterRun']}
): Promise<AgentResult> {
  if (!config?.afterRun) {
    return result;
  }

  try {
    await config.afterRun({...toHookContext(run), result});
    return result;
  } catch (error) {
    if (result.reason === 'error') {
      return result;
    }

    return createAgentResult(
      run.state,
      result.turns,
      'error',
      new Error(formatErrorMessage(error, 'afterRun failed'))
    );
  }
}

/** 执行非流式主循环。 */
export async function runLoop(run: AgentRunContext, runtime: AgentRuntime): Promise<AgentResult> {
  return runLoopCore(run, runtime, (context, execution, cycle) => runLoopIteration(
    context,
    execution,
    cycle,
    new NonStreamIterationStrategy(),
  ));
}

/** 执行流式主循环。 */
export async function streamLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream: AgentStreamWriter
): Promise<AgentResult> {
  return runLoopCore(run, runtime, (context, execution, cycle) => runLoopIteration(
    context,
    execution,
    cycle,
    new StreamIterationStrategy(stream),
  ));
}

export async function runBeforeModelStage(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  requestId: string
): Promise<BaseExecutionContext> {
  const context = createExecutionContext(run, turn, requestId);
  await runtime.prepareTurnContext?.(context);
  await runtime.pipeline.beforeAgent(context);
  await runtime.pipeline.beforeModel(context);
  return context;
}

/** 核心循环逻辑，由 runLoop 和 streamLoop 共享。 */
async function runLoopCore(
  run: AgentRunContext,
  runtime: AgentRuntime,
  executeIteration: (
    run: AgentRunContext,
    runtime: AgentRuntime,
    cycle: number,
  ) => Promise<LoopIterationOutcome>,
): Promise<AgentResult> {
  let iterations = 0;

  for (let cycle = 1; cycle <= run.maxTurns; cycle += 1) {
    iterations = cycle;

    try {
      const outcome = await executeIteration(run, runtime, cycle);
      if (outcome === 'complete') {
        return createAgentResult(run.state, iterations, 'complete');
      }
    } catch (error) {
      return createAgentResult(run.state, iterations, 'error', error);
    }
  }

  return createAgentResult(run.state, iterations, 'max_turns');
}

interface LoopIterationStrategy {
  executeModel(runtime: AgentRuntime, run: AgentRunContext, context: BaseExecutionContext): Promise<AIMessage>;
  afterModelMessage(message: AIMessage, run: AgentRunContext): Promise<void>;
  executeTools(run: AgentRunContext, runtime: AgentRuntime, context: BaseExecutionContext, toolCalls: ToolCall[]): Promise<void>;
}

class NonStreamIterationStrategy implements LoopIterationStrategy {
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

class StreamIterationStrategy implements LoopIterationStrategy {
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

type LoopIterationOutcome = 'continue' | 'complete';

async function runLoopIteration(
  run: AgentRunContext,
  runtime: AgentRuntime,
  cycle: number,
  strategy: LoopIterationStrategy,
): Promise<LoopIterationOutcome> {
  const cycleStartIndex = run.state.messages.length;
  const context = await runBeforeModelStage(run, runtime, cycle, `${run.runId}:turn:${cycle}`);
  const pipeline = runtime.pipeline;
  let cycleResult: AgentRunSummary = {reason: 'continue', turns: cycle};

  try {
    const modelMessage = await strategy.executeModel(runtime, run, context);
    run.state.messages.push(modelMessage);
    await strategy.afterModelMessage(modelMessage, run);

    await pipeline.afterModel({...context, response: modelMessage});

    if (!modelMessage.tool_calls?.length) {
      cycleResult = {reason: 'complete', turns: cycle};
    } else {
      await strategy.executeTools(run, runtime, context, modelMessage.tool_calls);
      const pause = readLatestPause(run.state.messages.slice(cycleStartIndex));
      if (pause) {
        run.state.pendingPause = pause;
        cycleResult = {reason: 'complete', turns: cycle};
      }
    }
  } catch (error) {
    cycleResult = {reason: 'error', turns: cycle, error: toError(error)};
  }

  await runAfterAgentStep(pipeline, context, cycleResult);

  if (cycleResult.error) {
    throw cycleResult.error;
  }

  return cycleResult.reason === 'complete' ? 'complete' : 'continue';
}

function toHookContext(run: AgentRunContext): AgentHookContext {
  return {
    state: run.state,
    runId: run.runId,
    maxTurns: run.maxTurns,
  };
}

type AgentHookContext = {
  state: AgentState;
  runId: string;
  maxTurns: number;
};

function normalizeMaxTurns(recursionLimit: number | undefined): number {
  const maxTurns = recursionLimit ?? DEFAULT_RECURSION_LIMIT;
  if (maxTurns < 1) {
    throw new Error('recursionLimit must be at least 1');
  }
  return maxTurns;
}

function createAgentResult(
  state: AgentState,
  turns: number,
  reason: AgentResult['reason'],
  error?: unknown
): AgentResult {
  return {
    reason,
    state,
    turns,
    ...(error === undefined ? {} : {error: toError(error)}),
  };
}

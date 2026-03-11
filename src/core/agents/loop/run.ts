import {randomUUID} from 'node:crypto';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentState,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {AgentModel} from '@core/agents/engine/model';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {runTurn, runTurnStream, type AgentTurnOutcome} from '@core/agents/loop/turn';
import type {BaseExecutionContext, MiddlewareRuntimeShared} from '@core/middleware';
import type {MiddlewarePipeline} from '@core/middleware/pipeline';
import {deepClone} from '@core/support/clone';
import {toError, formatErrorMessage} from '@core/support/errors';
import {mergeContext} from '@core/agents/engine/runtime-input';

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
  return runLoopCore(run, runtime, (r, rt, turn) => runTurn(r, rt, turn));
}

/** 执行流式主循环。 */
export async function streamLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream: AgentStreamWriter
): Promise<AgentResult> {
  return runLoopCore(run, runtime, (r, rt, turn) => runTurnStream(r, rt, turn, stream));
}

export async function runBeforeModelStage(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  requestId: string
): Promise<BaseExecutionContext> {
  const context = createExecutionContext(run, turn, requestId);
  await runtime.pipeline.beforeAgent(context);
  await runtime.pipeline.beforeModel(context);
  return context;
}

/** 核心循环逻辑，由 runLoop 和 streamLoop 共享。 */
async function runLoopCore(
  run: AgentRunContext,
  runtime: AgentRuntime,
  executeTurn: (run: AgentRunContext, runtime: AgentRuntime, turn: number) => Promise<AgentTurnOutcome>
): Promise<AgentResult> {
  let turns = 0;

  for (let turn = 1; turn <= run.maxTurns; turn += 1) {
    turns = turn;

    try {
      const outcome = await executeTurn(run, runtime, turn);
      if (outcome === 'complete') {
        return createAgentResult(run.state, turns, 'complete');
      }
    } catch (error) {
      return createAgentResult(run.state, turns, 'error', error);
    }
  }

  return createAgentResult(run.state, turns, 'max_turns');
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

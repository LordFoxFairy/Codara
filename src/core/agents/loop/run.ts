import {randomUUID} from 'node:crypto';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInvokeConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentState,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {AgentModel} from '@core/agents/engine/model';
import type {AgentStreamWriter} from '@core/agents/engine/stream-writer';
import {runTurn, runTurnStream} from '@core/agents/loop/turn';
import type {MiddlewarePipeline} from '@core/middleware';

const DEFAULT_RECURSION_LIMIT = 25;

/** 单次运行期间共享的上下文。 */
export interface AgentRunContext {
  state: AgentState;
  runId: string;
  maxTurns: number;
  context: AgentRuntimeContext;
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
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context'> = {}
): AgentRunContext {
  return {
    state,
    runId: randomUUID(),
    maxTurns: normalizeMaxTurns(config.recursionLimit),
    context: config.context ?? {},
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
    return createAgentResult(run.state, 0, 'error', new Error(`beforeRun failed: ${toError(error).message}`));
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
      new Error(`afterRun failed: ${toError(error).message}`)
    );
  }
}

/** 执行非流式主循环。 */
export async function runLoop(run: AgentRunContext, runtime: AgentRuntime): Promise<AgentResult> {
  let turns = 0;

  for (let turn = 1; turn <= run.maxTurns; turn += 1) {
    turns = turn;

    try {
      const outcome = await runTurn(run, runtime, turn);
      if (outcome === 'complete') {
        return createAgentResult(run.state, turns, 'complete');
      }
    } catch (error) {
      return createAgentResult(run.state, turns, 'error', error);
    }
  }

  return createAgentResult(run.state, turns, 'max_turns');
}

/** 执行流式主循环。 */
export async function streamLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream: AgentStreamWriter
): Promise<AgentResult> {
  let turns = 0;

  for (let turn = 1; turn <= run.maxTurns; turn += 1) {
    turns = turn;

    try {
      const outcome = await runTurnStream(run, runtime, turn, stream);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

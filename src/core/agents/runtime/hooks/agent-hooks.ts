import {randomUUID} from 'node:crypto';
import type {AgentInvokeConfig, AgentResult, AgentState} from '@core/agents/types';
import type {AgentLoopRuntime} from '@core/agents/runtime/shared/contracts';
import {createAgentHookContext} from '@core/agents/runtime/context/runtime-context';
import {createAgentResult, toError} from '@core/agents/runtime/shared/common';

const DEFAULT_RECURSION_LIMIT = 25;

/** 创建本次 invoke 的运行时上下文。 */
export function createAgentRuntime(state: AgentState, config?: AgentInvokeConfig): AgentLoopRuntime {
  return {
    state,
    runId: randomUUID(),
    maxTurns: normalizeMaxTurns(config?.recursionLimit)
  };
}

/** invoke 外 beforeRun hook。 */
export async function beforeRun(
  runtime: AgentLoopRuntime,
  config: AgentInvokeConfig | undefined
): Promise<AgentResult | undefined> {
  const beforeRunHook = config?.beforeRun;
  if (!beforeRunHook) {
    return undefined;
  }

  try {
    await beforeRunHook(createAgentHookContext(runtime));
    return undefined;
  } catch (error) {
    return createAgentResult(runtime.state, 0, 'error', new Error(`beforeRun failed: ${toError(error).message}`));
  }
}

/** invoke 外 afterRun hook。 */
export async function afterRun(
  runtime: AgentLoopRuntime,
  result: AgentResult,
  config?: AgentInvokeConfig
): Promise<AgentResult> {
  const afterRunHook = config?.afterRun;
  if (!afterRunHook) {
    return result;
  }

  try {
    await afterRunHook({...createAgentHookContext(runtime), result});
    return result;
  } catch (error) {
    if (result.reason === 'error') {
      return result;
    }

    return createAgentResult(
      runtime.state,
      result.turns,
      'error',
      new Error(`afterRun failed: ${toError(error).message}`)
    );
  }
}

function normalizeMaxTurns(recursionLimit: number | undefined): number {
  const maxTurns = recursionLimit ?? DEFAULT_RECURSION_LIMIT;
  if (maxTurns < 1) {
    throw new Error('recursionLimit must be at least 1');
  }
  return maxTurns;
}

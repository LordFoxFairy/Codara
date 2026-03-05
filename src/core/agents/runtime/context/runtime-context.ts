import type {AgentHookContext} from '@core/agents/types';
import type {BaseExecutionContext} from '@core/middleware';
import type {AgentLoopRuntime} from '@core/agents/runtime/shared/contracts';

/** 构造 invoke 外 hook 上下文。 */
export function createAgentHookContext(runtime: AgentLoopRuntime): AgentHookContext {
  return {
    state: runtime.state,
    runId: runtime.runId,
    maxTurns: runtime.maxTurns
  };
}

/** 构造单轮执行上下文。 */
export function createTurnContext(runtime: AgentLoopRuntime, turn: number): BaseExecutionContext {
  return {
    state: runtime.state,
    runId: runtime.runId,
    turn,
    maxTurns: runtime.maxTurns,
    requestId: createTurnRequestId(runtime.runId, turn)
  };
}

function createTurnRequestId(runId: string, turn: number): string {
  return `${runId}:turn:${turn}`;
}

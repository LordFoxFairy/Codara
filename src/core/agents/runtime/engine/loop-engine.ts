import type {AgentResult} from '@core/agents/types';
import type {AgentLoopRuntime, LoopExecutionDeps} from '@core/agents/runtime/shared/contracts';
import {createAgentResult} from '@core/agents/runtime/shared/common';
import {runTurn} from '@core/agents/runtime/stages/turn-stage';

/** loop 主入口：仅负责编排 turns */
export async function runAgentLoop(
  runtime: AgentLoopRuntime,
  deps: LoopExecutionDeps
): Promise<AgentResult> {
  let turns = 0;

  for (let turn = 1; turn <= runtime.maxTurns; turn += 1) {
    turns = turn;

    try {
      const outcome = await runTurn(runtime, deps, turn);

      if (outcome === 'complete') {
        return createAgentResult(runtime.state, turns, 'complete');
      }
    } catch (error) {
      return createAgentResult(runtime.state, turns, 'error', error);
    }
  }

  return createAgentResult(runtime.state, turns, 'max_turns');
}

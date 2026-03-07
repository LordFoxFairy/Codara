import type {AgentResult} from '@core/agents/types';
import type {AgentLoopRuntime, LoopExecutionDeps} from '@core/agents/runtime/shared/contracts';
import {createAgentResult} from '@core/agents/runtime/shared/common';
import {runTurnStream} from '@core/agents/runtime/stages/turn-stage';
import type {AgentStreamController} from '@core/agents/runtime/stream';

export async function runAgentLoopStream(
  runtime: AgentLoopRuntime,
  deps: LoopExecutionDeps,
  stream: AgentStreamController
): Promise<AgentResult> {
  let turns = 0;

  for (let turn = 1; turn <= runtime.maxTurns; turn += 1) {
    turns = turn;

    try {
      const outcome = await runTurnStream(runtime, deps, turn, stream);

      if (outcome === 'complete') {
        return createAgentResult(runtime.state, turns, 'complete');
      }
    } catch (error) {
      return createAgentResult(runtime.state, turns, 'error', error);
    }
  }

  return createAgentResult(runtime.state, turns, 'max_turns');
}

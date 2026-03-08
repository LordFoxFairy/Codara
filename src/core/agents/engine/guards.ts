import type {AgentRuntimeState} from '@core/agents/engine/state';

export function assertReadyForInvoke(state: AgentRuntimeState): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status === 'paused') {
    throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
  }
}

export function assertReadyForResume(state: AgentRuntimeState): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status !== 'paused' || !state.pendingPause) {
    throw new Error('Agent is not paused; resume(...) is only valid after a HIL pause.');
  }
}

export function assertNotRunning(state: AgentRuntimeState): void {
  if (state.status === 'running') {
    throw new Error('Agent is currently running.');
  }
}

function assertNotClosed(state: AgentRuntimeState): void {
  if (state.status === 'closed') {
    throw new Error('Agent is closed.');
  }
}

import type {AgentStateSnapshot} from '../contract/agent';

export function assertReadyForInvoke(state: AgentStateSnapshot): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status === 'paused') {
    throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
  }
}

export function assertReadyForResume(state: AgentStateSnapshot): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status !== 'paused' || !state.pendingPause) {
    throw new Error('Agent is not paused; resume(...) is only valid after a HIL pause.');
  }
}

export function assertNotRunning(state: AgentStateSnapshot): void {
  if (state.status === 'running') {
    throw new Error('Agent is currently running.');
  }
}

function assertNotClosed(state: AgentStateSnapshot): void {
  if (state.status === 'closed') {
    throw new Error('Agent is closed.');
  }
}

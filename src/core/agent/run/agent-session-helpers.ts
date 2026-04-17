/**
 * AgentSession-local helpers: state assertions, error-result construction,
 * and abort-signal combination. Factored out of agent-session.ts to keep that
 * file focused on orchestration logic.
 *
 * @module
 */

import type {AgentResult, AgentState} from '../agent-types';
import type {MutableAgentState} from '../state';

export function combineAbortSignals(internal: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return internal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([internal, external]);
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(internal.aborted ? internal.reason : external.reason);
  };
  if (internal.aborted || external.aborted) {
    onAbort();
  } else {
    internal.addEventListener('abort', onAbort, {once: true});
    external.addEventListener('abort', onAbort, {once: true});
  }
  return controller.signal;
}

export function assertReadyForInvoke(state: MutableAgentState): void {
  assertUsable(state);
  if (state.status === 'paused') {
    throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
  }
}

export function assertReadyForResume(state: MutableAgentState): void {
  assertUsable(state);
  if (state.status !== 'paused' || !state.pendingReview) {
    throw new Error('Agent is not paused; resume(...) is only valid after a review pause.');
  }
}

export function assertNotRunning(state: MutableAgentState): void {
  if (state.status === 'running') throw new Error('Agent is currently running.');
}

function assertUsable(state: MutableAgentState): void {
  if (state.status === 'running') throw new Error('Agent is currently running.');
  if (state.status === 'closed') throw new Error('Agent is closed.');
}

export function createErrorResult(state: AgentState, turns: number, message: string): AgentResult {
  return {reason: 'error', state, turns, error: new Error(message)};
}

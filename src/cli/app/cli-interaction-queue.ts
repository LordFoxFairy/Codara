/** @future — Interaction queue logic for the next CLI architecture rewrite. Extracted from use-cli-controller for testability. */
import type {CliInteractionScheduler, QueuedCliInteraction, QueuedReviewResponseInteraction} from './interaction-scheduler';
import type {CliInteractionKind, CliInteractionState} from './view-state';
import {resolveFocusedSurface} from './cli-controller-logic';
import type {CliReviewState} from './view-state';

/**
 * Reads the current scheduler state and resolves the interaction surface
 * into a CliInteractionState snapshot. This is the pure logic behind
 * `syncInteractionState` in the controller.
 */
export function resolveInteractionStateSnapshot(
  current: CliInteractionState,
  scheduler: CliInteractionScheduler,
  review: CliReviewState | undefined,
): CliInteractionState {
  const snapshot = scheduler.readSnapshot();
  const focusedSurface = resolveFocusedSurface(current.focusedSurface, review);
  return {
    focusedSurface,
    activeKind: snapshot.activeKind,
    pendingCount: snapshot.pendingCount,
    promptBlocked: focusedSurface !== 'prompt',
  };
}

/**
 * Result of attempting to take the next interaction from the queue.
 */
export type DrainResult =
  | {kind: 'busy'}
  | {kind: 'empty'}
  | {kind: 'session_prompt'; prompt: string}
  | {kind: 'review_response'; interaction: QueuedReviewResponseInteraction};

/**
 * Attempts to dequeue the next interaction from the scheduler.
 * Returns a discriminated result so the caller can dispatch appropriately
 * without re-implementing the queue inspection logic.
 */
export function takeNextScheduledInteraction(
  scheduler: CliInteractionScheduler,
): DrainResult {
  if (scheduler.isRunning()) {
    return {kind: 'busy'};
  }

  const next = scheduler.takeNextInteraction();
  if (!next) {
    return {kind: 'empty'};
  }

  if (next.kind === 'session_prompt') {
    return {kind: 'session_prompt', prompt: next.prompt};
  }

  return {kind: 'review_response', interaction: next};
}

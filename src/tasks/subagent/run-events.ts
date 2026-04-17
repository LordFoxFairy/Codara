/**
 * Event emission + waiter notification helpers for the run manager.
 *
 * Responsibilities:
 * - `makeAgentEventEmitter` — produce a closure over the caller's
 *   runtime-event listener + session-id getter, filling in event
 *   defaults (id, sessionId, timestamp).
 * - `notifyCompletionWaiters` — walk the registered completion
 *   waiters and resolve any that match the finished batch.
 *
 * Pure, stateless helpers; the run manager passes its state in.
 *
 * @module
 */

import type {CodaraRuntimeEventListener, EmitRuntimeEventInput} from '@events';
import type {SubagentRunStore} from '@tasks/subagent/types';
import {hasTrackedRuns} from './run-lifecycle';
import type {CompletionWaiter} from './run-manager-types';

export type AgentEventEmitter = (event: EmitRuntimeEventInput) => void;

/**
 * Build an event emitter that stamps runtime events with default
 * `id`, `sessionId`, and `timestamp` values before forwarding them
 * to the caller's listener. If no listener/session getter is set,
 * emissions are no-ops.
 */
export function makeAgentEventEmitter(
  getListener: () => CodaraRuntimeEventListener | undefined,
  getSessionId: () => string | (() => string) | undefined,
): AgentEventEmitter {
  return (event) => {
    const listener = getListener();
    const sessionGetter = getSessionId();
    if (!listener || !sessionGetter) {
      return;
    }

    const sessionId = typeof sessionGetter === 'function' ? sessionGetter() : sessionGetter;
    listener({
      ...event,
      id: event.id ?? `${event.kind}:${event.phase}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  };
}

/**
 * Walk all registered waiters and resolve those that correspond to
 * the finished batch. Resolved waiters are removed from the set by
 * their own `resolve` callback.
 */
export function notifyCompletionWaiters(
  waiters: Set<CompletionWaiter>,
  runStore: SubagentRunStore | undefined,
  parentSessionId: string,
  batchId: string,
): void {
  if (!runStore || waiters.size === 0) {
    return;
  }

  const normalizedParent = parentSessionId.trim();
  const normalizedBatch = batchId.trim();
  for (const waiter of [...waiters]) {
    if (waiter.parentSessionId !== normalizedParent || !waiter.batchIds.has(normalizedBatch)) {
      continue;
    }

    const claimed = runStore.takePendingCompletion(normalizedParent, [...waiter.batchIds]);
    if (claimed) {
      waiter.resolve(claimed);
      continue;
    }

    if (!hasTrackedRuns(runStore, normalizedParent, [...waiter.batchIds])) {
      waiter.resolve(undefined);
    }
  }
}

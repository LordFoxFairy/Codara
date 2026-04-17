/**
 * Runtime event routing + effect computation for the CLI controller.
 *
 * Two layers:
 *   1. {@link routeCliRuntimeEvent} — pure routing predicate: given an event,
 *      decide whether it seals the active turn, requires an auxiliary refresh,
 *      represents a foreground subagent review, and which notice to surface.
 *   2. {@link computeRuntimeEventEffects} — builds on the router to produce the
 *      full effect bundle the controller needs to apply (updated event list,
 *      agent count delta, refresh strategy, etc.). This keeps the useEffect
 *      callback thin — it only applies the returned effects to React state.
 */
import type {CodaraRuntimeEvent} from '@/index';
import {shouldHideRuntimeEventForTranscript} from '../features/transcript/model';
import {appendRuntimeEventPreservingOpenStarts} from './controller-logic';
import {sealActiveTurnAtRuntimeBoundary} from './interaction-turn';
import type {CliActiveTurn, CliNotice} from './view-state';

// ─── Layer 1: pure routing ───────────────────────────────────────────

export interface RuntimeEventRouteResult {
  foregroundSubagentReview: boolean;
  shouldSealActiveTurn: boolean;
  shouldRefreshAuxiliaryState: boolean;
  immediateNotice?: CliNotice;
  queuedNotice?: CliNotice;
}

export function routeCliRuntimeEvent(input: {
  event: CodaraRuntimeEvent;
  interactionRunning: boolean;
}): RuntimeEventRouteResult {
  const {event, interactionRunning} = input;
  const foregroundSubagentReview = isSubagentReviewEvent(event);
  const notice = summarizeBackgroundTaskNotice(event);

  return {
    foregroundSubagentReview,
    shouldSealActiveTurn: shouldSealActiveTurnForRuntimeEvent(event),
    shouldRefreshAuxiliaryState: !interactionRunning && !foregroundSubagentReview && shouldRefreshAuxiliaryState(event),
    ...(notice && !interactionRunning && !foregroundSubagentReview ? {immediateNotice: notice} : {}),
    ...(notice && interactionRunning && !foregroundSubagentReview ? {queuedNotice: notice} : {}),
  };
}

function shouldRefreshAuxiliaryState(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'agent' || event.kind === 'review';
}

function shouldSealActiveTurnForRuntimeEvent(event: CodaraRuntimeEvent): boolean {
  if (shouldHideRuntimeEventForTranscript(event)) {
    return false;
  }

  if (event.kind === 'tool') {
    return event.phase === 'start' || event.phase === 'end';
  }

  if (event.kind === 'agent') {
    return event.phase === 'start'
      || (event.phase === 'update' && event.status === 'paused')
      || event.phase === 'end';
  }

  return false;
}

function isSubagentReviewEvent(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'agent' && event.phase === 'update' && event.status === 'paused';
}

function summarizeBackgroundTaskNotice(event: CodaraRuntimeEvent): CliNotice | undefined {
  if (event.kind !== 'agent') {
    return undefined;
  }

  const detail = event.detail?.trim();
  const suffix = detail ? `: ${detail}` : '';

  if (event.phase === 'end' && event.status === 'error') {
    return {
      id: `task-notice:${event.id}`,
      level: 'error',
      content: `Background task failed${suffix}`,
    };
  }

  if (event.phase === 'update' && event.status === 'paused') {
    return {
      id: `task-notice:${event.id}`,
      level: 'warning',
      content: `Background task waiting for review${suffix}`,
    };
  }

  return undefined;
}

// ─── Layer 2: effect computation ─────────────────────────────────────

/**
 * Determines what refresh strategy to apply after a runtime event
 * has been routed and its immediate effects applied.
 */
export type PostEventRefreshStrategy =
  | {kind: 'none'}
  | {kind: 'auxiliary_only'}
  | {kind: 'core_then_settle'; agentPhase: string};

export interface RuntimeEventEffects {
  /** Updated runtime events array after appending the new event. */
  nextRuntimeEvents: readonly CodaraRuntimeEvent[];
  /** Updated active turn after sealing (if needed), or undefined to skip. */
  sealedActiveTurn?: (current: CliActiveTurn | undefined) => CliActiveTurn | undefined;
  /** Route result from the underlying event router. */
  route: RuntimeEventRouteResult;
  /** Agent count delta: +1 for start, -1 for end. */
  agentCountDelta: number;
  /** Notices to append immediately to the visible notice list. */
  immediateNotices: CliNotice[];
  /** Notices to queue for background delivery. */
  queuedNotices: CliNotice[];
  /** Whether the event represents a foreground subagent review that should
   *  interrupt the current interaction and pause. */
  foregroundSubagentReview: boolean;
  /** What kind of state refresh to perform after applying immediate effects. */
  refreshStrategy: PostEventRefreshStrategy;
  /** Whether to trigger interaction queue drain after event processing. */
  shouldDrainInteractions: boolean;
}

/**
 * Processes a single Codara runtime event and computes all effects that
 * the controller should apply. This keeps the useEffect callback thin —
 * it only needs to apply the returned effects to React state.
 */
export function computeRuntimeEventEffects(input: {
  event: CodaraRuntimeEvent;
  currentRuntimeEvents: readonly CodaraRuntimeEvent[];
  interactionRunning: boolean;
}): RuntimeEventEffects {
  const {event, currentRuntimeEvents, interactionRunning} = input;

  // 1. Route the event through the pure router
  const route = routeCliRuntimeEvent({event, interactionRunning});

  // 2. Compute agent count delta
  let agentCountDelta = 0;
  if ((event.kind === 'turn' || event.kind === 'agent') && event.phase === 'start') {
    agentCountDelta = 1;
  }
  if ((event.kind === 'turn' || event.kind === 'agent') && event.phase === 'end') {
    agentCountDelta = -1;
  }

  // 3. Append event to the events array
  const nextRuntimeEvents = appendRuntimeEventPreservingOpenStarts(currentRuntimeEvents, event);

  // 4. Determine if active turn should be sealed
  const sealedActiveTurn = route.shouldSealActiveTurn
    ? (current: CliActiveTurn | undefined) => sealActiveTurnAtRuntimeBoundary(current)
    : undefined;

  // 5. Collect notices
  const immediateNotices: CliNotice[] = route.immediateNotice ? [route.immediateNotice] : [];
  const queuedNotices: CliNotice[] = route.queuedNotice ? [route.queuedNotice] : [];

  // 6. Determine refresh strategy (the non-trivial decision logic)
  let refreshStrategy: PostEventRefreshStrategy = {kind: 'none'};

  if (!route.foregroundSubagentReview) {
    const shouldRefreshDuringRunningAgentHandoff = event.kind === 'agent'
      && (
        event.phase === 'end'
        || (event.phase === 'update' && event.status === 'paused')
      );

    if (shouldRefreshDuringRunningAgentHandoff || route.shouldRefreshAuxiliaryState) {
      if (event.kind === 'agent') {
        refreshStrategy = {kind: 'core_then_settle', agentPhase: event.phase};
      } else {
        refreshStrategy = {kind: 'auxiliary_only'};
      }
    }
  }

  // 7. Drain interactions on agent events
  const shouldDrainInteractions = event.kind === 'agent';

  return {
    nextRuntimeEvents,
    sealedActiveTurn,
    route,
    agentCountDelta,
    immediateNotices,
    queuedNotices,
    foregroundSubagentReview: route.foregroundSubagentReview,
    refreshStrategy,
    shouldDrainInteractions,
  };
}

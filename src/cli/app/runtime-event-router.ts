import type {CodaraRuntimeEvent} from '@/index';
import {shouldHideRuntimeEventForTranscript} from '../features/transcript/model';
import type {CliNotice} from './view-state';

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

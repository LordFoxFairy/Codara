import type {Codara, CodaraRuntimeEvent, AgentRunQuerySummary} from '@/index';
import {shouldHideRuntimeEventForTranscript} from '../transcript/model';
import type {CliNotice} from './view-state';

export interface TrackedTaskBatch {
  parentSessionId: string;
  expectedCount: number;
  runIds: Set<string>;
  continuationStarted: boolean;
}

export interface AgentCompletionHandoff {
  runId: string;
  label: string;
  agentName: string;
  status: 'completed' | 'failed';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface AgentCompletionContinuation {
  parentSessionId: string;
  runs: AgentCompletionHandoff[];
}

export interface RuntimeEventRouteResult {
  trackedTaskBatch: TrackedTaskBatch | undefined;
  foregroundDelegatedReview: boolean;
  shouldSealActiveTurn: boolean;
  shouldRefreshAuxiliaryState: boolean;
  immediateNotice?: CliNotice;
  queuedNotice?: CliNotice;
  completionContinuation?: AgentCompletionContinuation;
  runContinuationImmediately: boolean;
}

export function routeCliRuntimeEvent(input: {
  codara: Codara;
  event: CodaraRuntimeEvent;
  trackedTaskBatch: TrackedTaskBatch | undefined;
  interactionRunning: boolean;
}): RuntimeEventRouteResult {
  const {codara, event, interactionRunning} = input;
  const trackedTaskBatch = updateTrackedTaskBatch(event, input.trackedTaskBatch);
  const foregroundDelegatedReview = isDelegatedTaskReviewEvent(event);
  const completionContinuation = resolveAgentCompletionContinuation(codara, event, trackedTaskBatch);
  if (completionContinuation && trackedTaskBatch) {
    trackedTaskBatch.continuationStarted = true;
  }

  const notice = summarizeBackgroundTaskNotice(event);
  const runContinuationImmediately = Boolean(completionContinuation) && !interactionRunning && !foregroundDelegatedReview;

  return {
    trackedTaskBatch,
    foregroundDelegatedReview,
    shouldSealActiveTurn: shouldSealActiveTurnForRuntimeEvent(event),
    shouldRefreshAuxiliaryState: !interactionRunning && !foregroundDelegatedReview && shouldRefreshAuxiliaryState(event),
    ...(notice && !interactionRunning && !foregroundDelegatedReview ? {immediateNotice: notice} : {}),
    ...(notice && (interactionRunning || foregroundDelegatedReview === false) && (interactionRunning && !foregroundDelegatedReview)
      ? {queuedNotice: notice}
      : {}),
    ...(completionContinuation ? {completionContinuation} : {}),
    runContinuationImmediately,
  };
}

function shouldRefreshAuxiliaryState(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'agent' || event.kind === 'review';
}

function shouldSealActiveTurnForRuntimeEvent(event: CodaraRuntimeEvent): boolean {
  if ((event.kind !== 'tool' && event.kind !== 'agent') || shouldHideRuntimeEventForTranscript(event)) {
    return false;
  }

  return event.phase === 'start' || event.phase === 'end';
}

function isDelegatedTaskReviewEvent(event: CodaraRuntimeEvent): boolean {
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

function parseAgentRunIdFromEvent(event: CodaraRuntimeEvent): string | undefined {
  const candidate = event.parentId ?? event.id;
  const prefix = 'agent-run:';
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : undefined;
}

function isRunIdBackedTaskStartEvent(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'agent'
    && event.phase === 'start'
    && event.status === 'running'
    && Boolean(parseAgentRunIdFromEvent(event));
}

function isPendingTaskPlaceholderStartEvent(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'agent'
    && event.phase === 'start'
    && event.detail === 'pending';
}

function updateTrackedTaskBatch(
  event: CodaraRuntimeEvent,
  currentBatch: TrackedTaskBatch | undefined,
): TrackedTaskBatch | undefined {
  if (isPendingTaskPlaceholderStartEvent(event)) {
    if (!currentBatch || currentBatch.parentSessionId !== event.sessionId || currentBatch.continuationStarted) {
      return {
        parentSessionId: event.sessionId,
        expectedCount: 1,
        runIds: new Set(),
        continuationStarted: false,
      };
    }
    return {
      ...currentBatch,
      expectedCount: currentBatch.expectedCount + 1,
      runIds: new Set(currentBatch.runIds),
    };
  }

  if (!isRunIdBackedTaskStartEvent(event)) {
    return currentBatch;
  }

  const runId = parseAgentRunIdFromEvent(event)!;
  if (!currentBatch || currentBatch.parentSessionId !== event.sessionId || currentBatch.continuationStarted) {
    return {
      parentSessionId: event.sessionId,
      expectedCount: 1,
      runIds: new Set([runId]),
      continuationStarted: false,
    };
  }

  const runIds = new Set(currentBatch.runIds);
  runIds.add(runId);
  return {
    ...currentBatch,
    runIds,
    expectedCount: Math.max(currentBatch.expectedCount, runIds.size),
  };
}

function isAgentRunTerminal(run: AgentRunQuerySummary): boolean {
  return run.status === 'completed' || run.status === 'failed';
}

function toAgentCompletionHandoff(run: AgentRunQuerySummary): AgentCompletionHandoff {
  return {
    runId: run.runId,
    label: run.label,
    agentName: run.agentName,
    status: run.status === 'failed' ? 'failed' : 'completed',
    ...(run.summary?.trim() ? {summary: run.summary.trim()} : {}),
    ...(run.errorMessage?.trim() ? {errorMessage: run.errorMessage.trim()} : {}),
    ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
    ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
  };
}

function resolveAgentCompletionContinuation(
  codara: Codara,
  event: CodaraRuntimeEvent,
  batch: TrackedTaskBatch | undefined,
): AgentCompletionContinuation | undefined {
  if (event.kind !== 'agent' || event.phase !== 'end') {
    return undefined;
  }

  const runId = parseAgentRunIdFromEvent(event);
  if (!runId || !batch || batch.continuationStarted || batch.parentSessionId !== event.sessionId || !batch.runIds.has(runId)) {
    return undefined;
  }

  const agentRuns = codara.getAgentRunSummaries();
  const batchRuns = [...batch.runIds]
    .map((batchRunId) => agentRuns.find((run) => run.runId === batchRunId && run.parentSessionId === event.sessionId))
    .filter((run): run is AgentRunQuerySummary => Boolean(run));
  if (
    batch.runIds.size < batch.expectedCount
    || batchRuns.length !== batch.runIds.size
    || batchRuns.some((run) => !isAgentRunTerminal(run))
  ) {
    return undefined;
  }

  return {
    parentSessionId: event.sessionId,
    runs: batchRuns.map(toAgentCompletionHandoff),
  };
}

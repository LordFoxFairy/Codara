/**
 * Terminal / pause state application for subagent runs.
 *
 * After a child agent stream returns its {@link AgentResult}, the run
 * manager must:
 * - Persist the outcome to the run store + task registry.
 * - Emit the corresponding runtime event.
 * - Notify completion waiters.
 *
 * For a paused run (pendingReview), it also attaches recovery metadata
 * and upserts an approval record so the review can be resumed later.
 *
 * These helpers are factored out of the run manager so the main class
 * focuses on orchestration rather than state-machine bookkeeping.
 *
 * @module
 */

import type {AgentResult} from '@shared/agent-types';
import type {ApprovalStore} from '@state/approval-store';
import {createSubagentResult} from '@tasks/subagent/bootstrap';
import type {SubagentResult} from '@shared/subagent-result';
import type {SubagentRunStore} from '@tasks/subagent/types';
import type {TaskRegistry} from '@tasks/task-registry';
import {attachRecoveryMetadata} from './run-approval';
import {subagentRunEventId} from './run-lifecycle';
import type {AgentEventEmitter} from './run-events';
import type {ReviewRequest, SubagentRunHandle} from './run-manager-types';

export interface FinalizeDeps {
  runStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  taskRegistry?: TaskRegistry;
  emit: AgentEventEmitter;
}

/**
 * Apply a "paused for review" outcome: persist pause state, upsert the
 * approval record, and emit a `paused` runtime event.
 */
export function applyPauseResult(
  deps: FinalizeDeps,
  handle: SubagentRunHandle,
  pause: ReviewRequest,
): void {
  const persistedPause = attachRecoveryMetadata(pause, handle);
  deps.runStore?.pause(handle.runId, {
    childSessionId: handle.childSessionId,
    latestActivity: persistedPause.description,
  });
  deps.approvalStore?.upsertSubagentRunApproval({
    sessionId: handle.parentSessionId,
    subagentRunId: handle.runId,
    reviewRequest: persistedPause,
    childSessionId: handle.childSessionId,
  });
  deps.emit({
    kind: 'agent',
    phase: 'update',
    status: 'paused',
    label: 'Subagent waiting for review',
    detail: persistedPause.description,
    parentId: subagentRunEventId(handle.runId),
  });
}

/**
 * Apply a terminal (completed or errored) outcome: finalise store +
 * task registry, emit an `end` event, and return the {@link SubagentResult}
 * so the caller can notify completion waiters.
 */
export function applyTerminalResult(
  deps: FinalizeDeps,
  handle: SubagentRunHandle,
  result: AgentResult,
): SubagentResult {
  deps.approvalStore?.removeBySubagentRunId(handle.runId);
  const subagentResult = createSubagentResult(
    handle.childSessionId,
    result.turns,
    result.reason,
    result.error,
    result.state.messages,
    {
      runId: handle.runId,
      label: handle.label,
      agentName: handle.agentName,
    },
  );
  deps.runStore?.finish(handle.runId, subagentResult);

  const terminalStatus = subagentResult.reason === 'error' ? 'failed' as const : 'completed' as const;
  deps.taskRegistry?.terminate(handle.runId, terminalStatus, {
    summary: subagentResult.summary,
    errorMessage: subagentResult.errorMessage,
  });

  deps.emit({
    kind: 'agent',
    phase: 'end',
    status: subagentResult.reason === 'error' ? 'error' : 'done',
    label: subagentResult.reason === 'error' ? 'Subagent failed' : 'Subagent completed',
    detail: subagentResult.summary ?? subagentResult.errorMessage,
    parentId: subagentRunEventId(handle.runId),
  });

  return subagentResult;
}

/**
 * Apply a terminal-failure outcome triggered by an uncaught error
 * during the child agent stream. Behaves like {@link applyTerminalResult}
 * but synthesises a {@link SubagentResult} from the error.
 */
export function applyTerminalFailure(
  deps: FinalizeDeps,
  handle: SubagentRunHandle,
  error: unknown,
): SubagentResult {
  deps.approvalStore?.removeBySubagentRunId(handle.runId);
  const subagentResult: SubagentResult = {
    type: 'subagent_result',
    sessionId: handle.childSessionId,
    turns: 0,
    reason: 'error',
    runId: handle.runId,
    label: handle.label,
    agentName: handle.agentName,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
  deps.runStore?.finish(handle.runId, subagentResult);

  deps.taskRegistry?.terminate(handle.runId, 'failed', {
    errorMessage: subagentResult.errorMessage,
  });

  deps.emit({
    kind: 'agent',
    phase: 'end',
    status: 'error',
    label: 'Subagent failed',
    detail: subagentResult.errorMessage,
    parentId: subagentRunEventId(handle.runId),
  });

  return subagentResult;
}

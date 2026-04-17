/**
 * Handle resolution helpers for resume operations.
 *
 * After a process restart, `resumeRunStream` may be called for a run
 * that is tracked in the run store but not in the live handle map.
 * This module rebuilds a handle from persisted state using the
 * caller-registered recovery builder.
 *
 * @module
 */

import type {ApprovalStore} from '@state/approval-store';
import type {SubagentRunStore} from '@tasks/subagent/types';
import {findRunApproval} from './run-approval';
import {buildRecoveredHandle} from './run-lifecycle';
import type {SubagentRecoveryBuilder, SubagentRunHandle} from './run-manager-types';

export interface ResolveHandleDeps {
  handles: Map<string, SubagentRunHandle>;
  runStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  recoveryBuilder?: SubagentRecoveryBuilder;
}

/**
 * Resolve a handle for resume, either from the live map or by rebuilding
 * from persisted state. Throws with a descriptive error if recovery is
 * not possible.
 */
export async function resolveHandleForResume(
  deps: ResolveHandleDeps,
  runId: string,
): Promise<SubagentRunHandle> {
  const normalizedRunId = runId.trim();
  const existing = deps.handles.get(normalizedRunId);
  if (existing) {
    return existing;
  }

  const record = deps.runStore?.get(normalizedRunId);
  if (!record || !record.childSessionId) {
    throw new Error(`Subagent run "${runId}" is not active in this run manager`);
  }

  if (!deps.recoveryBuilder) {
    throw new Error(`Subagent run "${runId}" cannot be resumed after restart because no recovery builder is registered`);
  }

  const approval = findRunApproval(deps.approvalStore, record);
  const recovery = await deps.recoveryBuilder(record, approval);
  if (!recovery) {
    throw new Error(`Subagent run "${runId}" cannot be resumed because recovery metadata is incomplete`);
  }

  const recovered = buildRecoveredHandle(record, recovery);
  deps.handles.set(normalizedRunId, recovered);
  return recovered;
}

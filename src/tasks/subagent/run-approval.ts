/**
 * Approval-store helpers for the subagent run manager.
 *
 * Handles lookup + attachment of review approval records so the
 * main manager doesn't need to reach into the approval store
 * repeatedly.
 *
 * @module
 */

import type {ApprovalRecord, ApprovalStore} from '@state/approval-store';
import type {ReviewRequest} from '@core/agent';
import {mergeSubagentRunRecoveryMetadata} from '@tasks/subagent/review-metadata';
import type {SubagentRunRecord} from '@tasks/subagent/types';
import type {SubagentRunHandle} from './run-manager-types';

/**
 * Resolve the approval record for an approval id, ensuring it is a
 * subagent-run approval. Throws if no matching record exists.
 */
export function requireApprovalRecord(
  approvalStore: ApprovalStore | undefined,
  approvalId: string,
): ApprovalRecord {
  const record = approvalStore?.get(approvalId);
  if (!record || record.source !== 'subagent_run' || !record.subagentRunId) {
    throw new Error(`Subagent approval "${approvalId}" is not available`);
  }
  return record;
}

/** Find the existing subagent_run approval for a given run record, if any. */
export function findRunApproval(
  approvalStore: ApprovalStore | undefined,
  run: SubagentRunRecord,
): ApprovalRecord | undefined {
  return approvalStore
    ?.list(run.parentSessionId)
    .find((record) => record.source === 'subagent_run' && record.subagentRunId === run.runId);
}

/**
 * Attach recovery metadata (tool names, system messages, maxTurns) to
 * the review request so a restarted run manager can restore the child
 * agent from the approval store alone.
 */
export function attachRecoveryMetadata(review: ReviewRequest, handle: SubagentRunHandle): ReviewRequest {
  const recovery = {
    ...(handle.childOptions.tools?.length
      ? {toolNames: handle.childOptions.tools.map((tool) => tool.name)}
      : {}),
    ...(handle.childOptions.systemMessage?.length
      ? {systemMessages: [...handle.childOptions.systemMessage]}
      : {}),
    ...(typeof handle.maxTurns === 'number' ? {maxTurns: handle.maxTurns} : {}),
  };

  if (Object.keys(recovery).length === 0) {
    return review;
  }

  const base = review.metadata && typeof review.metadata === 'object'
    ? review.metadata as Record<string, unknown>
    : {};

  return {
    ...review,
    metadata: mergeSubagentRunRecoveryMetadata(base, {
      childSessionId: handle.childSessionId,
      recovery,
    }),
  };
}

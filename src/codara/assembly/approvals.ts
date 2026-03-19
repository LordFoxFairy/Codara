import type {ApprovalStore} from '@durability/approval-store';
import type {ApprovalQuerySummary} from '../types';

export function getApprovalSummaries(
  store: ApprovalStore | undefined,
  sessionId: string | undefined,
  focusedApprovalId?: string,
): ApprovalQuerySummary[] {
  if (!store || !sessionId) {
    return [];
  }

  return store.list(sessionId).map((record) => ({
    approvalId: record.approvalId,
    source: record.source,
    description: record.description,
    toolName: record.toolName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.taskRunId ? {taskRunId: record.taskRunId} : {}),
    ...(record.childSessionId ? {childSessionId: record.childSessionId} : {}),
    ...(record.teamId ? {teamId: record.teamId} : {}),
    ...(record.memberId ? {memberId: record.memberId} : {}),
    ...(record.memberName ? {memberName: record.memberName} : {}),
    isForeground: record.approvalId === focusedApprovalId,
  }));
}

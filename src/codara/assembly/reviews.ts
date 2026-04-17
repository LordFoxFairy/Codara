/**
 * Review item projection -- converts raw approval records and foreground
 * review requests into the unified `ReviewQueryItem[]` list for UI consumption.
 */

import type {ApprovalStore} from '@state/approval-store';
import type {ReviewRequest} from '@core/agent';
import type {
  ReviewBlockingScope,
  ReviewInteractionMode,
  ReviewQueryItem,
  ReviewQueryKind,
} from '../types';

/** Build the list of pending review items, merging queued approvals with the foreground review. */
export function getReviewItems(options: {
  approvalStore: ApprovalStore | undefined;
  sessionId: string | undefined;
  focusedReviewId?: string;
  foregroundReview?: ReviewRequest;
}): ReviewQueryItem[] {
  const {approvalStore, sessionId, focusedReviewId, foregroundReview} = options;
  const queuedItems = !approvalStore || !sessionId
    ? []
    : approvalStore.list(sessionId).map((record) => ({
        reviewId: record.approvalId,
        source: record.source,
        kind: 'approval' as const,
        interactionMode: 'approval' as const,
        blockingScope: 'task' as const,
        description: record.description,
        toolName: record.toolName,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        anchor: {
          origin: 'delegated' as const,
          ...(record.subagentRunId ? {subagentRunId: record.subagentRunId} : {}),
          ...(record.childSessionId ? {childSessionId: record.childSessionId} : {}),
        },
        isFocused: record.approvalId === focusedReviewId,
      }));

  if (!foregroundReview || queuedItems.some((item) => item.reviewId === foregroundReview.id)) {
    return queuedItems;
  }

  return [
    ...queuedItems,
    {
      reviewId: foregroundReview.id,
      source: 'session_review',
      kind: inferReviewKind(foregroundReview),
      interactionMode: inferReviewInteractionMode(foregroundReview),
      blockingScope: inferReviewBlockingScope(foregroundReview),
      description: foregroundReview.description,
      toolName: foregroundReview.action.toolName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      anchor: {
        origin: 'main',
      },
      isFocused: foregroundReview.id === focusedReviewId,
    },
  ];
}

/** Classify a review request into one of the query kind categories. */
function inferReviewKind(request: ReviewRequest): ReviewQueryKind {
  if (request.ui?.modal === 'permission-review' || request.channel === 'permission-center') {
    return 'permission';
  }
  if (request.action.toolName === 'AskUserQuestion' || request.channel === 'interaction-center' || request.ui?.form) {
    return 'ask_user';
  }
  if (request.review.allowedDecisions.includes('approve') || request.review.allowedDecisions.includes('reject')) {
    return 'approval';
  }
  return 'generic';
}

/** Determine the interaction style (approval buttons, form, freeform chat, hybrid). */
function inferReviewInteractionMode(request: ReviewRequest): ReviewInteractionMode {
  if (request.ui?.form) {
    return request.ui.actions?.some((action) => action.label.toLowerCase().includes('chat'))
      ? 'hybrid'
      : 'structured';
  }
  if (request.action.toolName === 'AskUserQuestion' || request.channel === 'interaction-center') {
    return 'hybrid';
  }
  if (request.review.allowedDecisions.length > 0) {
    return 'approval';
  }
  return 'freeform';
}

/** Determine the blocking scope -- currently always 'session' (placeholder for future task-level scoping). */
function inferReviewBlockingScope(_request: ReviewRequest): ReviewBlockingScope {
  return 'session';
}

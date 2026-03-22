import type {ApprovalStore} from '@durability/approval-store';
import type {PauseRequest} from '@core/agent';
import type {
  ReviewBlockingScope,
  ReviewInteractionMode,
  ReviewQueryItem,
  ReviewQueryKind,
} from '../types';

export function getReviewItems(options: {
  approvalStore: ApprovalStore | undefined;
  sessionId: string | undefined;
  focusedReviewId?: string;
  foregroundPause?: PauseRequest;
}): ReviewQueryItem[] {
  const {approvalStore, sessionId, focusedReviewId, foregroundPause} = options;
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
          ...(record.agentRunId ? {agentRunId: record.agentRunId} : {}),
          ...(record.childSessionId ? {childSessionId: record.childSessionId} : {}),
        },
        isFocused: record.approvalId === focusedReviewId,
      }));

  if (!foregroundPause || queuedItems.some((item) => item.reviewId === foregroundPause.id)) {
    return queuedItems;
  }

  return [
    ...queuedItems,
    {
      reviewId: foregroundPause.id,
      source: 'session_pause',
      kind: inferReviewKind(foregroundPause),
      interactionMode: inferReviewInteractionMode(foregroundPause),
      blockingScope: inferReviewBlockingScope(foregroundPause),
      description: foregroundPause.description,
      toolName: foregroundPause.action.toolName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      anchor: {
        origin: 'main',
      },
      isFocused: foregroundPause.id === focusedReviewId,
    },
  ];
}

function inferReviewKind(request: PauseRequest): ReviewQueryKind {
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

function inferReviewInteractionMode(request: PauseRequest): ReviewInteractionMode {
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

function inferReviewBlockingScope(_request: PauseRequest): ReviewBlockingScope {
  return 'session';
}

import type {AgentResult, AgentResumeStreamConfig, AgentStreamOutput, ReviewRequest, ReviewResumePayload} from '@core/agent';
import type {AgentRuntime} from '@capability/subagent';
import type {ApprovalStore} from '@durability/approval-store';
import type {Session} from '@durability/session';
import {getReviewItems} from './assembly/reviews';
import type {FocusedReviewQuery, ReviewQueryItem} from './types';

export interface CodaraReviewControl {
  listReviewItems(): ReviewQueryItem[];
  getFocusedReview(): FocusedReviewQuery | undefined;
  focusReview(reviewId: string): Promise<void>;
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<AgentResult | undefined>;
  streamReview(payload: ReviewResumePayload, config?: AgentResumeStreamConfig): AsyncGenerator<AgentStreamOutput, void, void>;
}

export function createCodaraReviewControl(options: {
  session: Session;
  approvalStore?: ApprovalStore;
  agentRuntime?: AgentRuntime;
}): CodaraReviewControl {
  const {session, approvalStore, agentRuntime} = options;
  let focusedReviewId: string | undefined;

  const listQueuedApprovalRecords = () => approvalStore?.list(session.getState().sessionId) ?? [];

  const readForegroundReview = (): ReviewRequest | undefined => {
    try {
      return session.getAgentState().pendingReview;
    } catch {
      return undefined;
    }
  };

  const listReviewItemsForSession = (): ReviewQueryItem[] => {
    const queuedRecords = listQueuedApprovalRecords();
    const foregroundPause = readForegroundReview();
    const resolvedFocusedReviewId = focusedReviewId
      ?? queuedRecords[0]?.approvalId
      ?? foregroundPause?.id;
    return getReviewItems({
      sessionId: session.getState().sessionId,
      approvalStore,
      focusedReviewId: resolvedFocusedReviewId,
      foregroundPause,
    });
  };

  const resolveFocusedReview = (): FocusedReviewQuery | undefined => {
    const queuedRecords = listQueuedApprovalRecords();
    const foregroundPause = readForegroundReview();
    const items = listReviewItemsForSession();

    if (items.length === 0) {
      focusedReviewId = undefined;
      return undefined;
    }

    const focusedItem = focusedReviewId
      ? items.find((item) => item.reviewId === focusedReviewId)
      : items[0];
    const item = focusedItem ?? items[0]!;
    focusedReviewId = item.reviewId;

    if (item.source === 'agent_run') {
      const record = queuedRecords.find((candidate) => candidate.approvalId === item.reviewId);
      if (!record) {
        return undefined;
      }
      return {
        item,
        request: record.reviewRequest,
      };
    }

    if (foregroundPause?.id === item.reviewId) {
      return {
        item,
        request: foregroundPause,
      };
    }

    return undefined;
  };

  return {
    listReviewItems: listReviewItemsForSession,
    getFocusedReview: resolveFocusedReview,
    focusReview: async (reviewId: string): Promise<void> => {
      const item = listReviewItemsForSession().find((candidate) => candidate.reviewId === reviewId);
      if (!item) {
        throw new Error(`Review "${reviewId}" not found for current session`);
      }
      focusedReviewId = reviewId;
    },
    resumeReview: async (payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<AgentResult | undefined> => {
      const focused = resolveFocusedReview();
      if (!focused) {
        throw new Error('No queued review is available for the current session');
      }

      if (focused.item.source === 'agent_run') {
        if (!agentRuntime) {
          throw new Error('Agent review runtime is not available');
        }
        await agentRuntime.resumeApprovalById(focused.item.reviewId, payload, config);
        resolveFocusedReview();
        return undefined;
      } else {
        const result = await session.resumeReview(payload, config);
        resolveFocusedReview();
        return result;
      }
    },
    streamReview: async function* (
      payload: ReviewResumePayload,
      config?: AgentResumeStreamConfig,
    ): AsyncGenerator<AgentStreamOutput, void, void> {
      const focused = resolveFocusedReview();
      if (!focused) {
        throw new Error('No queued review is available for the current session');
      }

      if (focused.item.source === 'agent_run') {
        if (!agentRuntime) {
          throw new Error('Agent review runtime is not available');
        }
        yield* agentRuntime.resumeApprovalByIdStream(focused.item.reviewId, payload, config);
      } else {
        yield* session.resumeReviewStream(payload, config);
      }

      resolveFocusedReview();
    },
  };
}

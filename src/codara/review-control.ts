/**
 * Review control -- manages the focused-review state and routes resume
 * decisions to either the foreground session or a background subagent run.
 *
 * Maintains a `focusedReviewId` pointer that the CLI/Desktop can set via
 * `focusReview()` to select which pending review item to interact with.
 */

import type {AgentResult, AgentResumeStreamConfig, AgentStreamOutput, ReviewRequest, ReviewResumePayload} from '@core/agent';
import type {SubagentReviewResumer} from '@tasks/subagent';
import type {ApprovalStore} from '@state/approval-store';
import type {Session} from '@state/session';
import {getReviewItems} from './assembly/reviews';
import type {FocusedReviewQuery, ReviewQueryItem} from './types';

/** Public interface for review list/focus/resume operations. */
export interface CodaraReviewControl {
  listReviewItems(): ReviewQueryItem[];
  getFocusedReview(): FocusedReviewQuery | undefined;
  focusReview(reviewId: string): Promise<void>;
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<AgentResult | undefined>;
  streamReview(
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult | undefined, void>;
}

/** Create a ReviewControl bound to a Session and its approval/subagent stores. */
export function createCodaraReviewControl(options: {
  session: Session;
  approvalStore?: ApprovalStore;
  subagentReviewResumer?: SubagentReviewResumer;
}): CodaraReviewControl {
  const {session, approvalStore, subagentReviewResumer} = options;
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
    const foregroundReview = readForegroundReview();
    const resolvedFocusedReviewId = focusedReviewId
      ?? queuedRecords[0]?.approvalId
      ?? foregroundReview?.id;
    return getReviewItems({
      sessionId: session.getState().sessionId,
      approvalStore,
      focusedReviewId: resolvedFocusedReviewId,
      foregroundReview,
    });
  };

  const resolveFocusedReview = (): FocusedReviewQuery | undefined => {
    const queuedRecords = listQueuedApprovalRecords();
    const foregroundReview = readForegroundReview();
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

    if (item.source === 'subagent_run') {
      const record = queuedRecords.find((candidate) => candidate.approvalId === item.reviewId);
      if (!record) {
        return undefined;
      }
      return {
        item,
        request: record.reviewRequest,
      };
    }

    if (foregroundReview?.id === item.reviewId) {
      return {
        item,
        request: foregroundReview,
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

      if (focused.item.source === 'subagent_run') {
        if (!subagentReviewResumer) {
          throw new Error('Subagent review run manager is not available');
        }
        await subagentReviewResumer.resumeApprovalById(focused.item.reviewId, payload, config);
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
    ): AsyncGenerator<AgentStreamOutput, AgentResult | undefined, void> {
      const focused = resolveFocusedReview();
      if (!focused) {
        throw new Error('No queued review is available for the current session');
      }

      if (focused.item.source === 'subagent_run') {
        if (!subagentReviewResumer) {
          throw new Error('Subagent review run manager is not available');
        }
        yield* subagentReviewResumer.resumeApprovalByIdStream(focused.item.reviewId, payload, config);
        resolveFocusedReview();
        return undefined;
      } else {
        const result = yield* session.resumeReviewStream(payload, config);
        resolveFocusedReview();
        return result;
      }
    },
  };
}

import type {Codara, ReviewQueryItem, ReviewRequest} from '@/index';
import {syncCliReviewState} from '../features/review/state-core';
import type {CliReviewState} from './view-state';

export interface CliReviewProjection {
  reviews: readonly ReviewQueryItem[];
  activeReviewRequest: ReviewRequest | undefined;
}

export function applyReviewMetadata(
  review: CliReviewState | undefined,
  reviews: readonly ReviewQueryItem[],
): CliReviewState | undefined {
  if (!review) {
    return undefined;
  }

  const currentIndex = reviews.findIndex((item) => item.reviewId === review.request.id);
  const currentItem = currentIndex >= 0 ? reviews[currentIndex] : undefined;
  return {
    ...review,
    blockingScope: currentItem?.blockingScope ?? review.blockingScope,
    reviewIndex: currentIndex >= 0 ? currentIndex + 1 : undefined,
    reviewCount: reviews.length > 0 ? reviews.length : undefined,
  };
}

export function readCliReviewProjection(
  codara: Pick<Codara, 'getFocusedReview' | 'listReviewItems' | 'getAgentState'>,
  options: {pendingReview?: ReviewRequest | undefined} = {},
): CliReviewProjection {
  const focusedReview = codara.getFocusedReview();
  const reviews = codara.listReviewItems();
  const activeReviewRequest = options.pendingReview ?? readForegroundReview(codara) ?? focusedReview?.request;
  return {reviews, activeReviewRequest};
}

export function syncProjectedReview(
  codara: Pick<Codara, 'getFocusedReview' | 'listReviewItems' | 'getAgentState'>,
  current: CliReviewState | undefined,
  options: {pendingReview?: ReviewRequest | undefined} = {},
): CliReviewState | undefined {
  const projection = readCliReviewProjection(codara, options);
  return applyReviewMetadata(
    syncCliReviewState(current, projection.activeReviewRequest),
    projection.reviews,
  );
}

function readForegroundReview(
  codara: Pick<Codara, 'getAgentState'>,
): ReviewRequest | undefined {
  try {
    return codara.getAgentState().pendingReview;
  } catch {
    return undefined;
  }
}

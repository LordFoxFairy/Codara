import type {Codara, ReviewQueryItem} from '@/index';
import type {PauseRequest} from '@core/agent';
import {syncCliReviewState} from './review-state';
import type {CliReviewState} from './view-state';

export interface CliReviewProjection {
  reviews: readonly ReviewQueryItem[];
  activePause: PauseRequest | undefined;
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
  options: {pendingPause?: PauseRequest | undefined} = {},
): CliReviewProjection {
  const focusedReview = codara.getFocusedReview();
  const reviews = codara.listReviewItems();
  const activePause = focusedReview?.request ?? options.pendingPause ?? readForegroundPause(codara);
  return {reviews, activePause};
}

export function syncProjectedReview(
  codara: Pick<Codara, 'getFocusedReview' | 'listReviewItems' | 'getAgentState'>,
  current: CliReviewState | undefined,
  options: {pendingPause?: PauseRequest | undefined} = {},
): CliReviewState | undefined {
  const projection = readCliReviewProjection(codara, options);
  return applyReviewMetadata(
    syncCliReviewState(current, projection.activePause),
    projection.reviews,
  );
}

function readForegroundPause(
  codara: Pick<Codara, 'getAgentState'>,
): PauseRequest | undefined {
  try {
    return codara.getAgentState().pendingPause;
  } catch {
    return undefined;
  }
}

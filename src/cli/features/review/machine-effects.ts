/**
 * Review machine side effects.
 *
 * Hooks that run side-effects for the review state machine. Today this is
 * just the auto-action driver used by headless / scripted review resolution;
 * keeping it in its own module makes the top-level hook easier to scan.
 */
import {useEffect, type MutableRefObject} from 'react';
import type {CliReviewAutoAction, CliReviewState, CliRunState} from '../../app/view-state';
import {REVIEW_AUTO_ACTION_DELAY_MS} from '../../app/controller-logic';

export interface UseReviewAutoActionsOptions {
  review: CliReviewState | undefined;
  runState: CliRunState;
  autoActionsRef: MutableRefObject<CliReviewAutoAction[]>;
  handledAutoReviewIdsRef: MutableRefObject<Set<string>>;
  submitReviewActionImpl: (autoAction?: CliReviewAutoAction) => void | Promise<void>;
}

export function useReviewAutoActions(options: UseReviewAutoActionsOptions): void {
  const {review, runState, autoActionsRef, handledAutoReviewIdsRef, submitReviewActionImpl} = options;

  useEffect(() => {
    if (!review || runState.status === 'running' || autoActionsRef.current.length === 0) {
      return;
    }

    if (handledAutoReviewIdsRef.current.has(review.request.id)) {
      return;
    }

    handledAutoReviewIdsRef.current.add(review.request.id);
    const nextAction = autoActionsRef.current.shift();
    if (!nextAction) {
      return;
    }

    const timer = setTimeout(() => {
      void submitReviewActionImpl(nextAction);
    }, REVIEW_AUTO_ACTION_DELAY_MS);

    return () => clearTimeout(timer);
  }, [review, runState.status, autoActionsRef, handledAutoReviewIdsRef, submitReviewActionImpl]);
}

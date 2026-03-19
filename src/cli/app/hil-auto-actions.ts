import {useEffect} from 'react';
import type {MutableRefObject} from 'react';
import type {CliHilAutoAction} from './hil-review';
import type {CliHilReviewState} from './view-state';

export interface UseCliHilAutoActionsInput {
  review: CliHilReviewState | undefined;
  isRunningRef: MutableRefObject<boolean>;
  autoActionsRef: MutableRefObject<CliHilAutoAction[]>;
  handledPauseIdsRef: MutableRefObject<Set<string>>;
  submitHilAction: (autoAction?: CliHilAutoAction) => void | Promise<void>;
  delayMs: number;
}

export function shouldQueueCliHilAutoAction(
  review: CliHilReviewState | undefined,
  isRunning: boolean,
  remainingAutoActions: number,
  handledPauseIds: ReadonlySet<string>,
): review is CliHilReviewState {
  return Boolean(
    review
    && !isRunning
    && remainingAutoActions > 0
    && !handledPauseIds.has(review.request.id),
  );
}

export function claimNextCliHilAutoAction(
  reviewId: string,
  autoActions: CliHilAutoAction[],
  handledPauseIds: Set<string>,
): CliHilAutoAction | undefined {
  if (handledPauseIds.has(reviewId)) {
    return undefined;
  }

  handledPauseIds.add(reviewId);
  return autoActions.shift();
}

export function useCliHilAutoActions(input: UseCliHilAutoActionsInput): void {
  const {
    review,
    isRunningRef,
    autoActionsRef,
    handledPauseIdsRef,
    submitHilAction,
    delayMs,
  } = input;

  useEffect(() => {
    if (!shouldQueueCliHilAutoAction(
      review,
      isRunningRef.current,
      autoActionsRef.current.length,
      handledPauseIdsRef.current,
    )) {
      return;
    }

    const nextAction = claimNextCliHilAutoAction(
      review.request.id,
      autoActionsRef.current,
      handledPauseIdsRef.current,
    );
    if (!nextAction) {
      return;
    }

    const timer = setTimeout(() => {
      void submitHilAction(nextAction);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [autoActionsRef, delayMs, handledPauseIdsRef, isRunningRef, review, submitHilAction]);
}

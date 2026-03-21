import React from 'react';
import {Box} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {isPermissionReviewState} from '../../app/review-permission-state';
import {AskUserReviewBody} from './review/ask-user-review';
import {GenericReviewBody} from './review/generic-review';
import {PermissionReviewBody} from './review/permission-review';
import {FloatingReviewShell, ReviewQueueBanner} from './review/review-panel-shell';

interface ReviewPanelProps {
  review: CliReviewState;
  terminalWidth?: number;
}

// ── Public API ──────────────────────────────────────────────

export function ReviewPanel({review, terminalWidth}: ReviewPanelProps): React.JSX.Element {
  const content = isPermissionReview(review)
    ? <PermissionReviewBody review={review} />
    : review.form
      ? <AskUserReviewBody review={review} terminalWidth={terminalWidth} />
      : <GenericReviewBody review={review} />;

  if (review.form) {
    return (
      <Box flexDirection="column">
        <ReviewQueueBanner review={review} />
        {content}
      </Box>
    );
  }

  return (
    <FloatingReviewShell review={review}>{content}</FloatingReviewShell>
  );
}

export function isPermissionReview(review: CliReviewState | undefined): boolean {
  return isPermissionReviewState(review);
}

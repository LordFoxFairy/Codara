import React from 'react';
import {Box} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {getCliReviewKind, isPermissionReviewState} from '../../app/review-kind';
import {AskUserReviewBody} from './review/ask-user-review';
import {GenericReviewBody} from './review/generic-review';
import {PermissionReviewBody} from './review/permission-review';
import {ToolReviewBody} from './review/tool-review';
import {FloatingReviewShell, ReviewQueueBanner} from './review/review-panel-shell';

interface ReviewPanelProps {
  review: CliReviewState;
  terminalWidth?: number;
}

// ── Public API ──────────────────────────────────────────────

export function ReviewPanel({review, terminalWidth}: ReviewPanelProps): React.JSX.Element {
  const kind = getCliReviewKind(review);
  const content = kind === 'permission'
    ? <PermissionReviewBody review={review} />
    : kind === 'ask-user'
      ? <AskUserReviewBody review={review} terminalWidth={terminalWidth} />
      : kind === 'tool-review'
        ? <ToolReviewBody review={review} />
        : <GenericReviewBody review={review} />;

  if (kind === 'ask-user') {
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

import React from 'react';
import {Box} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {getCliReviewKind, isPermissionReviewState} from './kind';
import {AskUserReviewBody} from './ask-user-view';
import {GenericReviewBody} from './generic-view';
import {PermissionReviewBody} from './permission';
import {ToolReviewBody} from './tool-view';
import {FloatingReviewShell, ReviewQueueBanner} from './panel-shell';

interface ReviewPanelProps {
  review: CliReviewState;
  terminalWidth?: number;
}

// ── Public API ──────────────────────────────────────────────

export function ReviewPanel({review, terminalWidth}: ReviewPanelProps): React.JSX.Element {
  const kind = getCliReviewKind(review);
  const content = kind === 'permission'
    ? <PermissionReviewBody review={review} terminalWidth={terminalWidth} />
    : kind === 'ask-user'
      ? <AskUserReviewBody review={review} terminalWidth={terminalWidth} />
      : kind === 'tool-review'
        ? <ToolReviewBody review={review} />
        : <GenericReviewBody review={review} />;

  if (kind === 'ask-user' || kind === 'permission') {
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

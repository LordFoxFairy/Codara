import React from 'react';
import {Box, Text} from 'ink';
import {theme} from '../../../utils/theme';
import type {CliReviewState} from '../../../app/view-state';
import {isPermissionReviewState} from '../../../app/review-permission-state';

export function ReviewQueueBanner({review}: {review: CliReviewState}): React.JSX.Element | null {
  if (review.form) {
    return null;
  }

  if (review.reviewIndex === undefined || review.reviewCount === undefined) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{`Review ${review.reviewIndex}/${review.reviewCount}`}</Text>
      <Text dimColor>Use [ and ] to switch reviews</Text>
    </Box>
  );
}

export function FloatingReviewShell(
  {review, children}: React.PropsWithChildren<{review: CliReviewState}>,
): React.JSX.Element {
  const title = isPermissionReviewState(review) ? 'Permission Review' : 'Review Required';
  const hints = 'Enter apply  Esc cancel';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.interactive.title}>{title}</Text>
        <Text dimColor>{hints}</Text>
      </Box>
      <ReviewQueueBanner review={review} />
      {children}
    </Box>
  );
}

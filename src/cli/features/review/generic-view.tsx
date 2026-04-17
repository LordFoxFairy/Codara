import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {resolveActionColor} from './panel-helpers';

export function GenericReviewBody({review}: {review: CliReviewState}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>Review Required</Text>
      <Text>{review.request.description}</Text>
      {review.actions.map((action, index) => (
        <Text key={index} color={resolveActionColor(action, index === review.selectedActionIndex)}>
          {index === review.selectedActionIndex ? '❯ ' : '  '}{action.label}
        </Text>
      ))}
      {review.draft !== undefined && review.focus === 'input' && (
        <Text color="cyan">Note › {review.draft || '(empty)'}</Text>
      )}
      <Text dimColor>Up/Down select · [ / ] reviews · Enter submit</Text>
      {review.busy && <Text color="cyan">Applying...</Text>}
    </Box>
  );
}

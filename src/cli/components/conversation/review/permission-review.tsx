import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../../app/view-state';
import {formatPermissionShortcut, resolveActionColor} from './review-panel-helpers';

export function PermissionReviewBody({review}: {review: CliReviewState}): React.JSX.Element {
  const stage = review.permissionStage ?? 'prompt';

  if (stage === 'always-confirm') {
    const patterns = review.permissionAlwaysPatterns ?? [];
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>Always allow</Text>
        {patterns.length > 0 && patterns[0] !== '*' ? (
          <Box flexDirection="column" paddingLeft={2}>
            {patterns.map((pattern, index) => <Text key={index} dimColor>- {pattern}</Text>)}
          </Box>
        ) : (
          <Text dimColor>This will allow the permission until Codara is restarted.</Text>
        )}
        <Box marginTop={1}>
          <Text color={review.selectedActionIndex === 0 ? 'green' : undefined}>
            {review.selectedActionIndex === 0 ? '❯ ' : '  '}Confirm
          </Text>
          <Text>{'  '}</Text>
          <Text color={review.selectedActionIndex === 1 ? 'cyan' : undefined}>
            {review.selectedActionIndex === 1 ? '❯ ' : '  '}Cancel
          </Text>
        </Box>
        <Text dimColor>Enter confirm · Esc cancel</Text>
        {review.busy && <Text color="cyan">Running...</Text>}
      </Box>
    );
  }

  if (stage === 'reject-feedback') {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Rejection feedback (optional):</Text>
        <Text color={review.draft ? 'green' : 'gray'}>Reason › {review.draft || '(empty)'}</Text>
        <Text dimColor>Enter send · Esc reject silently</Text>
        {review.busy && <Text color="red">Running...</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>{review.request.description}</Text>
      {review.actions.map((action, index) => (
        <Text key={index} color={resolveActionColor(action, index === review.selectedActionIndex)}>
          {index === review.selectedActionIndex ? '❯ ' : '  '}{formatPermissionShortcut(action)}
        </Text>
      ))}
      <Text dimColor>y allow · a always · n reject</Text>
      {review.busy && <Text color="yellow">Running...</Text>}
    </Box>
  );
}

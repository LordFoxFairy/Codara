import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {formatToolSummary} from '@shared/tool-display';
import {resolveActionColor} from './panel-helpers';

function stringifyEditedToolArgs(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function ToolReviewBody({review}: {review: CliReviewState}): React.JSX.Element {
  const toolName = review.request.action.toolName;
  const toolSummary = formatToolSummary(toolName, review.request.action.toolArgs);
  const activeAction = review.actions[review.selectedActionIndex];
  const showEditedArgs = activeAction?.requiresToolEdit && review.focus === 'input';
  const editedArgsText = showEditedArgs
    ? stringifyEditedToolArgs(review.request.metadata && typeof review.request.metadata === 'object'
      ? (review.request.metadata as Record<string, unknown>).editedToolArgs
      : undefined)
    : undefined;

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>{toolName}</Text>
      {toolSummary && <Text dimColor>{toolSummary}</Text>}
      <Box marginTop={1}>
        <Text>{review.request.description}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {review.actions.map((action, index) => (
          <Text key={index} color={resolveActionColor(action, index === review.selectedActionIndex)}>
            {index === review.selectedActionIndex ? '❯ ' : '  '}{action.label}
          </Text>
        ))}
      </Box>
      {review.draft !== undefined && review.focus === 'input' && (
        <Text color="cyan">
          {showEditedArgs ? 'Edited arguments › ' : 'Note › '}
          {review.draft || editedArgsText || '(empty)'}
        </Text>
      )}
      <Text dimColor>Up/Down select · [ / ] reviews · Enter submit</Text>
      {review.busy && <Text color="cyan">Applying...</Text>}
    </Box>
  );
}

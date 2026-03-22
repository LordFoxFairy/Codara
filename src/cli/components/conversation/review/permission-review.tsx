import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../../app/view-state';
import {formatToolDisplayName, formatToolSummary} from '../../../../shared/tool-display';
import {formatPermissionShortcut, resolveActionColor} from './review-panel-helpers';

export function PermissionReviewBody(
  {review, terminalWidth}: {review: CliReviewState; terminalWidth?: number},
): React.JSX.Element {
  const stage = review.permissionStage ?? 'prompt';

  if (stage === 'always-confirm') {
    return renderAlwaysConfirmStage(review, terminalWidth);
  }

  if (stage === 'reject-feedback') {
    return renderRejectFeedbackStage(review, terminalWidth);
  }

  const model = buildPermissionViewModel(review);
  const width = Math.max(48, Math.min((terminalWidth ?? 84) - 4, 96));
  const topRule = '─'.repeat(width);

  return (
    <Box flexDirection="column">
      <Text color="blue">{topRule}</Text>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color="blue" bold>{model.title}</Text>
        {model.body ? (
          <Box marginTop={1}>
            <Text dimColor>{model.body}</Text>
          </Box>
        ) : null}
        {model.target ? (
          <Box marginTop={1}>
            <Text dimColor>{model.target}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text>Do you want to proceed?</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {review.actions.map((action, index) => (
            <Text key={action.id} color={resolveActionColor(action, index === review.selectedActionIndex)}>
              {index === review.selectedActionIndex ? '› ' : '  '}{formatPermissionShortcut(action)}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel · Tab to amend</Text>
        </Box>
        {review.busy && (
          <Box marginTop={1}>
            <Text color="yellow">Applying...</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function renderAlwaysConfirmStage(review: CliReviewState, terminalWidth?: number): React.JSX.Element {
  const patterns = review.permissionAlwaysPatterns ?? [];
  const width = Math.max(48, Math.min((terminalWidth ?? 84) - 4, 96));
  const topRule = '─'.repeat(width);
  return (
    <Box flexDirection="column">
      <Text color="blue">{topRule}</Text>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color="blue" bold>Allow this action in the future?</Text>
        {patterns.length > 0 && patterns[0] !== '*' ? (
          <Box flexDirection="column" marginTop={1}>
            {patterns.map((pattern) => (
              <Text key={pattern} dimColor>{pattern}</Text>
            ))}
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>This permission will stay allowed until Codara is restarted.</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text color={review.selectedActionIndex === 0 ? 'green' : undefined}>
            {review.selectedActionIndex === 0 ? '› ' : '  '}Confirm
          </Text>
          <Text color={review.selectedActionIndex === 1 ? 'cyan' : undefined}>
            {review.selectedActionIndex === 1 ? '› ' : '  '}Cancel
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter confirm · Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}

function renderRejectFeedbackStage(review: CliReviewState, terminalWidth?: number): React.JSX.Element {
  const width = Math.max(48, Math.min((terminalWidth ?? 84) - 4, 96));
  const topRule = '─'.repeat(width);
  return (
    <Box flexDirection="column">
      <Text color="blue">{topRule}</Text>
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color="blue" bold>Why are you rejecting this?</Text>
        <Box marginTop={1}>
          <Text color={review.draft ? 'green' : 'gray'}>{review.draft || '(optional)'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter send · Esc reject silently</Text>
        </Box>
      </Box>
    </Box>
  );
}

function buildPermissionViewModel(review: CliReviewState): {
  title: string;
  body?: string;
  target?: string;
} {
  const toolName = review.request.action.toolName;
  const displayName = formatToolDisplayName(toolName);
  const summary = formatToolSummary(toolName, review.request.action.toolArgs);
  const sanitizedDescription = sanitizePermissionDescription(review.request.description);

  if (toolName === 'Skill') {
    return {
      title: `Use skill "${summary ?? 'unknown'}"?`,
      body: sanitizedDescription,
    };
  }

  if (toolName === 'read_file' || toolName === 'read') {
    return {
      title: 'Read this file?',
      body: sanitizedDescription,
      target: summary,
    };
  }

  if (toolName === 'write_file' || toolName === 'write') {
    return {
      title: 'Write this file?',
      body: sanitizedDescription,
      target: summary,
    };
  }

  if (toolName === 'edit_file' || toolName === 'edit') {
    return {
      title: 'Edit this file?',
      body: sanitizedDescription,
      target: summary,
    };
  }

  if (toolName === 'bash') {
    return {
      title: 'Run this command?',
      body: sanitizedDescription,
      target: summary,
    };
  }

  return {
    title: `Allow ${displayName}?`,
    body: sanitizedDescription,
    target: summary,
  };
}

function sanitizePermissionDescription(description: string): string | undefined {
  const trimmed = description.trim();
  if (!trimmed) {
    return undefined;
  }

  const toolSectionIndex = trimmed.indexOf('\n\nTool:');
  const base = toolSectionIndex >= 0 ? trimmed.slice(0, toolSectionIndex).trim() : trimmed;
  return base || undefined;
}

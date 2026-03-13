import React from 'react';
import {Box, Text} from 'ink';
import type {CliHilReviewState} from '../../app/view-state';

interface HilPanelProps {
  review: CliHilReviewState;
}

export function HilPanel({review}: HilPanelProps): React.JSX.Element {
  const selectedAction = review.actions[review.selectedActionIndex];
  const inputTitle = selectedAction?.requiresToolEdit ? 'Edited tool args JSON' : 'Optional note';
  const codaraMetadata = readCodaraHilMetadata(review.request.metadata);

  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">HIL Review</Text>
      <Text>{review.request.description}</Text>
      <Text dimColor>
        {`Channel ${review.request.channel || 'default'} | Tab ${review.request.ui?.tab || 'Review'}`}
      </Text>
      {codaraMetadata ? <Text dimColor>{codaraMetadata}</Text> : null}
      <Text dimColor wrap="truncate-end">
        {`Tool ${review.request.action.toolName} ${JSON.stringify(review.request.action.toolArgs ?? {})}`}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {review.actions.map((action, index) => {
          const selected = index === review.selectedActionIndex;
          const suffix = action.requiresToolEdit ? ' [edit]' : action.requiresConfirmation ? ' [confirm]' : '';
          return (
            <Box key={action.id} flexDirection="column">
              <Text color={selected ? 'green' : undefined}>
                {`${selected ? '>' : ' '} ${action.label}${suffix}`}
              </Text>
              {action.description ? <Text dimColor>{`  ${action.description}`}</Text> : null}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={review.focus === 'input' ? 'green' : 'gray'}>
          {`${review.focus === 'input' ? '>' : ' '} ${inputTitle}`}
        </Text>
        <Text>{review.draft || '(empty)'}</Text>
      </Box>

      <Text dimColor>
        Tab switch focus. Up/Down choose action. Enter submit. Shift+Enter inserts newline in the input box.
      </Text>
      {review.busy ? <Text color="cyan">Applying HIL decision...</Text> : null}
    </Box>
  );
}

function readCodaraHilMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const codara = (metadata as Record<string, unknown>).codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const parts: string[] = [];
  const actor = (codara as Record<string, unknown>).actor;
  if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
    const agentType = (actor as Record<string, unknown>).agentType;
    if (typeof agentType === 'string' && agentType.trim()) {
      parts.push(`Actor ${agentType}`);
    }
  }

  const delegated = (codara as Record<string, unknown>).delegatedSubagent;
  if (delegated && typeof delegated === 'object' && !Array.isArray(delegated)) {
    const childSessionId = (delegated as Record<string, unknown>).childSessionId;
    if (typeof childSessionId === 'string' && childSessionId.trim()) {
      parts.push(`Delegate ${childSessionId}`);
    }
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
}

import React from 'react';
import {Box, Text} from 'ink';

export interface CommandOutputPanelProps {
  content: string;
  commandName?: string;
}

/**
 * Floating panel that displays slash-command output below the chat input.
 * Separated from conversation — not persisted in checkpoints.
 */
export function CommandOutputPanel({content, commandName}: CommandOutputPanelProps): React.JSX.Element {
  const lines = content.split('\n');
  const label = commandName ? `/${commandName}` : 'command output';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Box marginBottom={lines.length > 1 ? 1 : 0}>
        <Text dimColor bold>{label}</Text>
      </Box>
      {lines.map((line, index) => (
        <Text key={index}>{line || ' '}</Text>
      ))}
    </Box>
  );
}

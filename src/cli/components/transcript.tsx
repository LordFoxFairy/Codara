import React from 'react';
import {Box, Text} from 'ink';
import type {CliMessage} from '../state/shell-types';

interface TranscriptProps {
  messages: CliMessage[];
}

const ROLE_LABEL_MAP: Record<CliMessage['role'], string> = {
  system: 'system',
  user: 'you',
  assistant: 'codara',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<CliMessage['role'], React.ComponentProps<typeof Text>['color']> = {
  system: 'cyan',
  user: 'green',
  assistant: 'magenta',
  error: 'red',
};

export function Transcript({messages}: TranscriptProps): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      {messages.map(message => (
        <Box key={message.id} marginBottom={1} flexDirection="column">
          <Text color={ROLE_COLOR_MAP[message.role]}>{ROLE_LABEL_MAP[message.role]}</Text>
          <Text>{message.content || '(empty)'}</Text>
        </Box>
      ))}
    </Box>
  );
}

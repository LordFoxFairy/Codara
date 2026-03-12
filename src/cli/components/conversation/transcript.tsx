import React from 'react';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import {buildTranscriptItems} from '../../transcript/model';

interface TranscriptProps {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
}

const ROLE_LABEL_MAP: Record<'system' | 'warning' | 'user' | 'assistant' | 'error', string> = {
  system: 'system',
  warning: 'warning',
  user: 'you',
  assistant: 'codara',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<'system' | 'warning' | 'user' | 'assistant' | 'error', React.ComponentProps<typeof Text>['color']> = {
  system: 'cyan',
  warning: 'yellow',
  user: 'green',
  assistant: 'magenta',
  error: 'red',
};

export function Transcript({coreMessages, notices, activeTurn}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn});

  return (
    <Box marginTop={1} flexDirection="column">
      {items.map((item) => (
        <Box key={item.id} marginBottom={1} flexDirection="column">
          <Text color={ROLE_COLOR_MAP[item.role]}>{ROLE_LABEL_MAP[item.role]}</Text>
          <Text>{item.content || '(empty)'}</Text>
        </Box>
      ))}
    </Box>
  );
}

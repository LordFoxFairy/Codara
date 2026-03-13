import React from 'react';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import {buildTranscriptItems, type TranscriptRole} from '../../transcript/model';

interface TranscriptProps {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
}

const ROLE_LABEL_MAP: Record<TranscriptRole, string> = {
  system: 'system',
  warning: 'warning',
  user: 'you',
  assistant: 'codara',
  tool: 'tools',
  task: 'tasks',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<TranscriptRole, React.ComponentProps<typeof Text>['color']> = {
  system: 'cyan',
  warning: 'yellow',
  user: 'green',
  assistant: 'magenta',
  tool: 'blueBright',
  task: 'yellowBright',
  error: 'red',
};

export function Transcript({coreMessages, notices, activeTurn}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn});

  return (
    <Box marginTop={1} flexDirection="column">
      {items.map((item) => (
        <TranscriptBlock key={item.id} role={item.role} content={item.content} />
      ))}
    </Box>
  );
}

function TranscriptBlock({role, content}: {role: TranscriptRole; content: string}): React.JSX.Element {
  if (role === 'tool' || role === 'task') {
    const lines = content.split('\n');
    return (
      <Box marginBottom={1} flexDirection="column" borderStyle="round" borderColor={ROLE_COLOR_MAP[role]} paddingX={1}>
        <Text color={ROLE_COLOR_MAP[role]}>{ROLE_LABEL_MAP[role]}</Text>
        {lines.map((line, index) => (
          <Text key={`${role}-${index}`}>{line || ' '}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color={ROLE_COLOR_MAP[role]}>{ROLE_LABEL_MAP[role]}</Text>
      <Text>{content || '(empty)'}</Text>
    </Box>
  );
}

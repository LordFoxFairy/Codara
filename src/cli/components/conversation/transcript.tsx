import React from 'react';
import type {CodaraRuntimeEvent} from '@core';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import {buildTranscriptItems, type TranscriptRole} from '../../transcript/model';

interface TranscriptProps {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
}

const ROLE_LABEL_MAP: Record<TranscriptRole, string> = {
  system: 'system',
  warning: 'warning',
  user: 'you',
  assistant: 'codara',
  tool: 'tools',
  task: 'tasks',
  hil: 'review',
  command: 'command',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<TranscriptRole, React.ComponentProps<typeof Text>['color']> = {
  system: 'cyan',
  warning: 'yellow',
  user: 'green',
  assistant: 'magenta',
  tool: 'blueBright',
  task: 'yellowBright',
  hil: 'cyanBright',
  command: 'cyan',
  error: 'red',
};

export function Transcript({coreMessages, notices, activeTurn, runtimeEvents}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn, runtimeEvents});

  return (
    <Box marginTop={1} flexDirection="column">
      {items.map((item) => (
        <TranscriptBlock key={item.id} role={item.role} content={item.content} />
      ))}
    </Box>
  );
}

function TranscriptBlock({role, content}: {role: TranscriptRole; content: string}): React.JSX.Element {
  const lines = content.split('\n');
  const label = formatRoleLabel(role);
  const firstLine = lines[0] || '(empty)';
  const trailingLines = lines.slice(1);

  return (
    <Box marginBottom={1} flexDirection="column">
      <Box>
        <Text color={ROLE_COLOR_MAP[role]}>{label}</Text>
        <Text>{firstLine}</Text>
      </Box>
      {trailingLines.length > 0 ? (
        <Box paddingLeft={label.length} flexDirection="column">
          {trailingLines.map((line, index) => (
            <Text key={`${role}-${index}`} dimColor>
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function formatRoleLabel(role: TranscriptRole): string {
  return `${ROLE_LABEL_MAP[role].padEnd(8)} `;
}

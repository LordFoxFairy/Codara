import React from 'react';
import type {CodaraRuntimeEvent} from '@core';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import {buildTranscriptItems, type ToolResultMeta, type TranscriptRole} from '../../transcript/model';

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
      {items.map((item) =>
        item.toolMeta ? (
          <ToolResultBlock key={item.id} meta={item.toolMeta} />
        ) : (
          <TranscriptBlock key={item.id} role={item.role} content={item.content} renderHint={item.renderHint} />
        ),
      )}
    </Box>
  );
}

function TranscriptBlock({role, content, renderHint}: {role: TranscriptRole; content: string; renderHint?: 'inline' | 'block'}): React.JSX.Element {
  const lines = content.split('\n');
  const label = formatRoleLabel(role);
  const firstLine = lines[0] || '(empty)';
  const trailingLines = lines.slice(1);
  const isToolResult = role === 'tool' || role === 'task';

  // Tool results use └ tree connector style
  if (isToolResult && trailingLines.length > 0) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color={ROLE_COLOR_MAP[role]}>{label}</Text>
          <Text>{firstLine}</Text>
        </Box>
        {renderHint === 'block' ? (
          <Box paddingLeft={label.length} flexDirection="column">
            {trailingLines.map((line, index) => (
              <Text key={`${role}-${index}`} dimColor>
                <Text color="gray">│ </Text>{line || ' '}
              </Text>
            ))}
          </Box>
        ) : (
          <Box paddingLeft={label.length} flexDirection="column">
            {trailingLines.map((line, index) => (
              <Text key={`${role}-${index}`} dimColor>
                {index === trailingLines.length - 1 ? '└ ' : '│ '}{line || ' '}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Tool call headers (single line) get └ for result
  if (isToolResult && trailingLines.length === 0) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color={ROLE_COLOR_MAP[role]}>{label}</Text>
          <Text>{firstLine}</Text>
        </Box>
      </Box>
    );
  }

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

const EDIT_LINE_COLORS: Record<string, React.ComponentProps<typeof Text>['color']> = {
  '+': 'green',
  '-': 'red',
};

function ToolResultBlock({meta}: {meta: ToolResultMeta}): React.JSX.Element {
  const {icon, displayName, args, summaryLine, outputLines, totalOutputLines, status} = meta;
  const header = args ? `${icon} ${displayName}(${args})` : `${icon} ${displayName}`;
  const hiddenLines = (totalOutputLines ?? 0) - (outputLines?.length ?? 0);
  const isEdit = meta.toolName === 'edit' || meta.toolName === 'edit_file';

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold>{header}</Text>
      <Box paddingLeft={2}>
        <Text dimColor color={status === 'error' ? 'red' : undefined}>
          {'└ '}{summaryLine}
        </Text>
      </Box>
      {outputLines && outputLines.length > 0 ? (
        <Box paddingLeft={5} flexDirection="column">
          {outputLines.map((line, index) => {
            const lineColor = isEdit ? EDIT_LINE_COLORS[line.charAt(0)] : undefined;
            return (
              <Text key={index} dimColor color={lineColor}>
                {line}
              </Text>
            );
          })}
          {hiddenLines > 0 ? (
            <Text dimColor>{`… +${hiddenLines} lines`}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function formatRoleLabel(role: TranscriptRole): string {
  return `${ROLE_LABEL_MAP[role].padEnd(8)} `;
}

import React from 'react';
import {Box, Text} from 'ink';

export interface CommandOutputPanelProps {
  content: string;
  commandName?: string;
  scrollOffset: number;
}

/**
 * Floating command output panel — visually distinct from chat.
 *
 * Renders as a bordered window that overlays the conversation area.
 * Esc to dismiss, ↑↓ to scroll when content overflows.
 */
export const MAX_COMMAND_OUTPUT_LINES = 20;

export function CommandOutputPanel({content, commandName, scrollOffset}: CommandOutputPanelProps): React.JSX.Element {
  const allLines = content.split('\n');
  const label = commandName ? `/${commandName}` : 'output';
  const total = allLines.length;
  const hasOverflow = total > MAX_COMMAND_OUTPUT_LINES;
  const maxOffset = Math.max(0, total - MAX_COMMAND_OUTPUT_LINES);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visibleLines = hasOverflow
    ? allLines.slice(clampedOffset, clampedOffset + MAX_COMMAND_OUTPUT_LINES)
    : allLines;

  const hasAbove = clampedOffset > 0;
  const hasBelow = hasOverflow && clampedOffset < maxOffset;

  // Position indicator: "3-22/58"
  const posLabel = hasOverflow
    ? `${clampedOffset + 1}–${Math.min(clampedOffset + MAX_COMMAND_OUTPUT_LINES, total)}/${total}`
    : undefined;

  // Hints for the footer bar
  const hints: string[] = [];
  if (hasOverflow) hints.push('↑↓ scroll');
  hints.push('esc close');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">{label}</Text>
        <Box>
          {posLabel && <Text dimColor>{posLabel}  </Text>}
          <Text dimColor>{hints.join('  ')}</Text>
        </Box>
      </Box>

      {/* Scroll-up indicator */}
      {hasAbove && <Text dimColor>{'↑ …'}</Text>}

      {/* Content */}
      {visibleLines.map((line, index) => (
        <Text key={clampedOffset + index} wrap="truncate-end">{line || ' '}</Text>
      ))}

      {/* Scroll-down indicator */}
      {hasBelow && <Text dimColor>{'↓ …'}</Text>}
    </Box>
  );
}

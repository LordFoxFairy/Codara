import React from 'react';
import {Box, Text} from 'ink';

export interface CommandOutputPanelProps {
  content: string;
  commandName?: string;
  scrollOffset: number;
}

/**
 * Non-modal command output panel — shows above the prompt, never blocks input.
 *
 * Design principles (inspired by Claude Code):
 * - Lightweight: single-line top/bottom border, no heavy box
 * - Scrollable: ↑↓ when prompt is empty, position indicator when overflow
 * - Non-blocking: prompt stays visible underneath
 * - Dismissible: Esc closes, next submit auto-clears
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

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header line */}
      <Box>
        <Text dimColor bold>{label}</Text>
        {posLabel && <Text dimColor>  {posLabel}</Text>}
        <Text dimColor>  esc close</Text>
        {hasOverflow && <Text dimColor>  ↑↓ scroll</Text>}
      </Box>

      {/* Scroll-up indicator */}
      {hasAbove && <Text dimColor>{'  ↑ …'}</Text>}

      {/* Content */}
      {visibleLines.map((line, index) => (
        <Text key={clampedOffset + index} wrap="truncate-end">{'  '}{line || ' '}</Text>
      ))}

      {/* Scroll-down indicator */}
      {hasBelow && <Text dimColor>{'  ↓ …'}</Text>}
    </Box>
  );
}

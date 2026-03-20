import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';
import {theme} from '../../utils/theme';

const VIEWPORT_SIZE = 10;
const NAME_COL_WIDTH = 26;
const COLUMN_GAP = 2;
const MIN_NAME_COL_WIDTH = 14;
const MAX_NAME_COL_WIDTH = 30;
const MIN_DESC_COL_WIDTH = 20;
const PANEL_FRAME_WIDTH = 4;
const DEFAULT_TERMINAL_WIDTH = 80;

export interface CompletionLayout {
  panelWidth: number;
  contentWidth: number;
  nameColumnWidth: number;
  gapWidth: number;
  descriptionColumnWidth: number;
}

interface CompletionMenuProps {
  completion: CommandCompletionState;
  terminalWidth?: number;
}

export function truncateWithEllipsis(value: string, width: number): string {
  if (width <= 0) {
    return '';
  }

  if (value.length <= width) {
    return value;
  }

  if (width <= 3) {
    return '.'.repeat(width);
  }

  return `${value.slice(0, width - 3)}...`;
}

export function calculateCompletionLayout(
  terminalWidth: number,
  preferredNameColumnWidth = NAME_COL_WIDTH,
): CompletionLayout {
  const safeTerminalWidth = Math.max(36, terminalWidth || DEFAULT_TERMINAL_WIDTH);
  const panelWidth = Math.max(36, safeTerminalWidth - 2);
  const contentWidth = Math.max(24, panelWidth - PANEL_FRAME_WIDTH);
  const maxNameColumnWidth = Math.max(
    MIN_NAME_COL_WIDTH,
    contentWidth - COLUMN_GAP - MIN_DESC_COL_WIDTH,
  );
  const nameColumnWidth = Math.max(
    MIN_NAME_COL_WIDTH,
    Math.min(preferredNameColumnWidth, Math.min(MAX_NAME_COL_WIDTH, maxNameColumnWidth)),
  );
  const descriptionColumnWidth = Math.max(
    1,
    contentWidth - nameColumnWidth - COLUMN_GAP,
  );

  return {
    panelWidth,
    contentWidth,
    nameColumnWidth,
    gapWidth: COLUMN_GAP,
    descriptionColumnWidth,
  };
}

function formatNameCell(name: string, selected: boolean, width: number): string {
  const prefix = selected ? '› ' : '  ';
  const availableWidth = Math.max(1, width - prefix.length);
  return `${prefix}${truncateWithEllipsis(name, availableWidth).padEnd(availableWidth)}`;
}

export function CompletionMenu({completion, terminalWidth = DEFAULT_TERMINAL_WIDTH}: CompletionMenuProps): React.JSX.Element | null {
  if (!completion.visible || completion.items.length === 0) {
    return null;
  }

  const {items, selectedIndex} = completion;
  const total = items.length;

  // Calculate viewport window around selected item
  let viewStart = 0;
  if (total > VIEWPORT_SIZE) {
    const centered = selectedIndex - Math.floor(VIEWPORT_SIZE / 2);
    viewStart = Math.max(0, Math.min(centered, total - VIEWPORT_SIZE));
  }
  const viewEnd = Math.min(total, viewStart + VIEWPORT_SIZE);
  const visibleItems = items.slice(viewStart, viewEnd);
  const hasMoreAbove = viewStart > 0;
  const hasMoreBelow = viewEnd < total;
  const preferredNameColumnWidth = Math.min(
    MAX_NAME_COL_WIDTH,
    Math.max(
      MIN_NAME_COL_WIDTH,
      ...visibleItems.map((item) => `/${item.name}`.length + 2),
    ),
  );
  const layout = calculateCompletionLayout(terminalWidth, preferredNameColumnWidth);
  const hintText = truncateWithEllipsis('tab accept  esc close', layout.descriptionColumnWidth);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.chrome.border}
      paddingX={1}
      width={layout.panelWidth}
    >
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color={theme.interactive.title}>Commands</Text>
        <Text dimColor>{hintText}</Text>
      </Box>

      {hasMoreAbove && <Text dimColor>↑ {viewStart} more</Text>}
      {visibleItems.map((item, index) => {
        const realIndex = viewStart + index;
        const selected = realIndex === selectedIndex;
        const nameText = `/${item.name}`;
        const leftCell = formatNameCell(nameText, selected, layout.nameColumnWidth);
        const rightCell = truncateWithEllipsis(item.description, layout.descriptionColumnWidth);
        return (
          <Box key={item.name} width={layout.contentWidth}>
            <Box width={layout.nameColumnWidth} flexShrink={0}>
              <Text color={selected ? theme.interactive.selection : undefined} bold={selected}>
                {leftCell}
              </Text>
            </Box>
            <Box width={layout.gapWidth} flexShrink={0}>
              <Text>{' '.repeat(layout.gapWidth)}</Text>
            </Box>
            <Box width={layout.descriptionColumnWidth} flexShrink={0}>
              <Text dimColor>{rightCell}</Text>
            </Box>
          </Box>
        );
      })}
      {hasMoreBelow && <Text dimColor>↓ {total - viewEnd} more</Text>}
    </Box>
  );
}

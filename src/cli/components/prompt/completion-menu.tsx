import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';
import {theme} from '../../utils/theme';

const VIEWPORT_SIZE = 10;
const NAME_COL_WIDTH = 26;

interface CompletionMenuProps {
  completion: CommandCompletionState;
}

export function CompletionMenu({completion}: CompletionMenuProps): React.JSX.Element | null {
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

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
      {/* Title bar */}
      <Box justifyContent="space-between">
        <Text bold color={theme.interactive.title}>Commands</Text>
        <Text dimColor>tab accept  esc close</Text>
      </Box>

      {hasMoreAbove && <Text dimColor>↑ {viewStart} more</Text>}
      {visibleItems.map((item, index) => {
        const realIndex = viewStart + index;
        const selected = realIndex === selectedIndex;
        const nameText = `/${item.name}`;
        // Truncate long command names (e.g. skill names)
        const displayName = nameText.length > NAME_COL_WIDTH - 1
          ? nameText.slice(0, NAME_COL_WIDTH - 2) + '…'
          : nameText;
        const padded = displayName.padEnd(NAME_COL_WIDTH);
        return (
          <Box key={item.name}>
            <Text color={selected ? theme.interactive.selection : undefined} bold={selected}>
              {selected ? '› ' : '  '}{padded}
            </Text>
            <Text dimColor wrap="truncate-end">{item.description}</Text>
          </Box>
        );
      })}
      {hasMoreBelow && <Text dimColor>↓ {total - viewEnd} more</Text>}
    </Box>
  );
}

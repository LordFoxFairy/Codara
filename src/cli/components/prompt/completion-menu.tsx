import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';

const VIEWPORT_SIZE = 10;
const NAME_COL_WIDTH = 24;

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
    <Box flexDirection="column" paddingX={1}>
      {hasMoreAbove && <Text dimColor>  ↑ {viewStart} more</Text>}
      {visibleItems.map((item, index) => {
        const realIndex = viewStart + index;
        const selected = realIndex === selectedIndex;
        const nameText = `/${item.name}`;
        const padded = nameText.padEnd(NAME_COL_WIDTH);
        return (
          <Box key={item.name}>
            <Text color={selected ? 'greenBright' : undefined} bold={selected}>
              {selected ? '› ' : '  '}{padded}
            </Text>
            <Text dimColor wrap="truncate-end">{item.description}</Text>
          </Box>
        );
      })}
      {hasMoreBelow && <Text dimColor>  ↓ {total - viewEnd} more</Text>}
    </Box>
  );
}

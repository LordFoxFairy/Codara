import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';

const VIEWPORT_SIZE = 10;

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
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {hasMoreAbove && <Text dimColor>  ↑ {viewStart} more</Text>}
      {visibleItems.map((item, index) => {
        const realIndex = viewStart + index;
        const selected = realIndex === selectedIndex;
        return (
          <Box key={item.name} gap={1}>
            <Text color={selected ? 'greenBright' : 'gray'} bold={selected}>
              {selected ? '>' : ' '} /{item.name}
            </Text>
            <Text dimColor>({item.sourceLabel})</Text>
            <Text dimColor wrap="truncate-end">{item.description}</Text>
          </Box>
        );
      })}
      {hasMoreBelow && <Text dimColor>  ↓ {total - viewEnd} more</Text>}
      <Text dimColor>Enter select · Tab complete · Esc cancel</Text>
    </Box>
  );
}

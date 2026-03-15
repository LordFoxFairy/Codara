import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';

interface CompletionMenuProps {
  completion: CommandCompletionState;
}

export function CompletionMenu({completion}: CompletionMenuProps): React.JSX.Element | null {
  if (!completion.visible || completion.items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {completion.items.map((item, index) => {
        const selected = index === completion.selectedIndex;
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
      <Text dimColor>Enter select · Tab complete · Esc cancel</Text>
    </Box>
  );
}

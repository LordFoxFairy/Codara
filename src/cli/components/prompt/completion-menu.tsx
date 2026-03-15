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
    <Box flexDirection="column" marginBottom={0}>
      {completion.items.map((item, index) => {
        const selected = index === completion.selectedIndex;
        return (
          <Box key={item.name} gap={1}>
            <Text color={selected ? 'greenBright' : undefined} bold={selected}>
              {selected ? '>' : ' '} /{item.name}
            </Text>
            <Text dimColor>({item.sourceLabel})</Text>
            <Text dimColor wrap="truncate-end">{item.description}</Text>
          </Box>
        );
      })}
      <Text dimColor>Enter to select · Tab to complete · Esc to cancel</Text>
    </Box>
  );
}

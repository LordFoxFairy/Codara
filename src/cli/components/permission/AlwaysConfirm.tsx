// src/cli/components/permission/AlwaysConfirm.tsx

import React from 'react';
import {Box, Text} from 'ink';

interface AlwaysConfirmProps {
  patterns: string[];
  selectedIndex: number;
  onConfirm: (pattern: string) => void;
  onBack: () => void;
}

/**
 * Stage 2: "Always" confirmation.
 * Shows suggested patterns and lets user pick one.
 */
export const AlwaysConfirm: React.FC<AlwaysConfirmProps> = ({
  patterns,
  selectedIndex,
  onConfirm,
  onBack,
}) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Allow always with pattern:</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {patterns.map((pattern, index) => (
          <Box key={pattern}>
            <Text color={index === selectedIndex ? 'green' : undefined}>
              {index === selectedIndex ? '> ' : '  '}
              {pattern}
            </Text>
          </Box>
        ))}
      </Box>

      <Box>
        <Text color="green">[Enter]</Text>
        <Text> Confirm  </Text>
        <Text dimColor>[Esc]</Text>
        <Text dimColor> Back</Text>
      </Box>
    </Box>
  );
};

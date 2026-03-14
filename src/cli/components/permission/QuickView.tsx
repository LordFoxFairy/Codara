// src/cli/components/permission/QuickView.tsx

import React from 'react';
import { Box, Text } from 'ink';
import type { PermissionViewProps } from './types';

export const QuickView: React.FC<PermissionViewProps> = ({
  toolCall,
  evaluation,
  onAction
}) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">{toolCall.tool}</Text>
        <Text> </Text>
        <Text dimColor>{toolCall.input}</Text>
      </Box>

      <Box flexDirection="column">
        <Box>
          <Text color="green">[y]</Text>
          <Text> Yes</Text>
        </Box>
        <Box>
          <Text color="blue">[a]</Text>
          <Text> Yes, don't ask again</Text>
        </Box>
        <Box>
          <Text color="red">[n]</Text>
          <Text> No</Text>
        </Box>
        <Box>
          <Text dimColor>[d]</Text>
          <Text dimColor> Details</Text>
        </Box>
      </Box>
    </Box>
  );
};

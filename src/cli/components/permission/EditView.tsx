// src/cli/components/permission/EditView.tsx

import React from 'react';
import { Box, Text } from 'ink';
import type { PermissionViewProps } from './types';

interface EditViewProps extends PermissionViewProps {
  editedInput: string;
  onInputChange: (value: string) => void;
  onBack: () => void;
}

export const EditView: React.FC<EditViewProps> = ({
  toolCall,
  evaluation,
  editedInput,
  onInputChange,
  onAction,
  onBack
}) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">Edit Command</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Tool:</Text>
        <Text>  {toolCall.tool}</Text>
        <Text dimColor>Original:</Text>
        <Text>  {toolCall.input}</Text>
        <Text dimColor>Edited:</Text>
        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text>{editedInput}</Text>
        </Box>
      </Box>

      <Box flexDirection="column">
        <Box>
          <Text color="green">[Enter]</Text>
          <Text> Execute edited command</Text>
        </Box>
        <Box>
          <Text dimColor>[Esc]</Text>
          <Text dimColor> Cancel</Text>
        </Box>
      </Box>
    </Box>
  );
};

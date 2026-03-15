// src/cli/components/permission/RejectFeedback.tsx

import React from 'react';
import {Box, Text} from 'ink';

interface RejectFeedbackProps {
  feedback: string;
  onSend: (message: string) => void;
  onRejectSilently: () => void;
}

/**
 * Stage 3: Rejection feedback.
 * User can optionally provide a reason for rejecting.
 */
export const RejectFeedback: React.FC<RejectFeedbackProps> = ({
  feedback,
  onSend: _onSend,
  onRejectSilently: _onRejectSilently,
}) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="red">Rejection feedback (optional):</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="cyan">{`> ${feedback}`}</Text>
        <Text dimColor>_</Text>
      </Box>

      <Box>
        <Text color="green">[Enter]</Text>
        <Text> Send  </Text>
        <Text dimColor>[Esc]</Text>
        <Text dimColor> Reject silently</Text>
      </Box>
    </Box>
  );
};

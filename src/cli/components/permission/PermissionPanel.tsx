// src/cli/components/permission/PermissionPanel.tsx

import React, {useState} from 'react';
import {Box, Text} from 'ink';
import {ToolCallDisplay} from './ToolCallDisplay';
import {AlwaysConfirm} from './AlwaysConfirm';
import {RejectFeedback} from './RejectFeedback';
import type {PermissionPanelProps, PermissionStage, PermissionUIReply} from './types';

/**
 * Three-stage permission panel.
 *
 * Stage 1 (prompt):           [y] Allow once  [a] Always  [n] Reject
 * Stage 2 (always-confirm):   Pick a pattern → [Enter] Confirm  [Esc] Back
 * Stage 3 (reject-feedback):  Optional message → [Enter] Send  [Esc] Reject silently
 */
export const PermissionPanel: React.FC<PermissionPanelProps> = ({
  toolName,
  toolArgs,
  evaluation,
  alwaysPatterns = [],
  onReply,
}) => {
  const [stage, setStage] = useState<PermissionStage>('prompt');
  const [selectedPatternIndex, setSelectedPatternIndex] = useState(0);
  const [rejectFeedback, setRejectFeedback] = useState('');

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case 'y':
        onReply({type: 'once'});
        break;
      case 'a':
        if (alwaysPatterns.length > 0) {
          setStage('always-confirm');
        } else {
          // No patterns to choose from, just allow always with default
          onReply({type: 'always', pattern: '*'});
        }
        break;
      case 'n':
        setStage('reject-feedback');
        break;
    }
  };

  if (stage === 'always-confirm') {
    return (
      <AlwaysConfirm
        patterns={alwaysPatterns}
        selectedIndex={selectedPatternIndex}
        onConfirm={(pattern) => onReply({type: 'always', pattern})}
        onBack={() => setStage('prompt')}
      />
    );
  }

  if (stage === 'reject-feedback') {
    return (
      <RejectFeedback
        feedback={rejectFeedback}
        onSend={(message) => onReply({type: 'reject', message})}
        onRejectSilently={() => onReply({type: 'reject'})}
      />
    );
  }

  // Stage 1: Main prompt
  return (
    <Box flexDirection="column" paddingX={1}>
      <ToolCallDisplay toolName={toolName} toolArgs={toolArgs} />

      <Box marginTop={1}>
        <Text color="green">[y]</Text>
        <Text> Allow once  </Text>
        <Text color="blue">[a]</Text>
        <Text> Always  </Text>
        <Text color="red">[n]</Text>
        <Text> Reject</Text>
      </Box>
    </Box>
  );
};

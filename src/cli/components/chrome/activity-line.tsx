import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent} from '@/index';
import type {SessionMetadata} from '@durability/session/types';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {useStatusIndicator} from '../../hooks/use-status-indicator';

interface ActivityLineProps {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
  sessionMetadata?: SessionMetadata;
  runningSubagentRunCount?: number;
  pausedSubagentRunCount?: number;
  hasVisibleAssistantReply?: boolean;
}

import {formatTokenCount} from '../../utils/format';

/**
 * Activity indicator line. Always renders a single line to prevent layout shifts.
 * Shows spinner/status when active, empty line when idle.
 */
export function ActivityLine({
  runState,
  activeTurn,
  latestRuntimeEvent,
  sessionMetadata,
  runningSubagentRunCount,
  pausedSubagentRunCount,
  hasVisibleAssistantReply,
}: ActivityLineProps): React.JSX.Element {
  const status = useStatusIndicator({
    runState,
    activeTurn,
    latestRuntimeEvent,
    runningSubagentRunCount,
    pausedSubagentRunCount,
    hasVisibleAssistantReply,
  });

  if (!status.banner) {
    // Render empty stable-height line to prevent layout jump
    return <Box height={1}><Text> </Text></Box>;
  }

  // Show real-time streaming tokens if available, else last-call tokens
  const streaming = activeTurn?.streamingTokens;
  let tokenSuffix = '';
  if (runState.status === 'running') {
    if (streaming && (streaming.input > 0 || streaming.output > 0)) {
      tokenSuffix = ` (↓${formatTokenCount(streaming.input)} ↑${formatTokenCount(streaming.output)})`;
    } else {
      const lastTokens = sessionMetadata?.usage?.lastTotalTokens;
      if (lastTokens && lastTokens > 0) {
        tokenSuffix = ` (last: ${formatTokenCount(lastTokens)} tok)`;
      }
    }
  }

  return (
    <Box height={1}>
      <Text color={status.color}>{status.banner}{tokenSuffix}</Text>
    </Box>
  );
}

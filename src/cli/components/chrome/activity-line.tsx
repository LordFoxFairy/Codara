import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent} from '@/index';
import type {SessionMetadata} from '@engine/session/types';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {useStatusIndicator} from '../../hooks/use-status-indicator';

interface ActivityLineProps {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
  sessionMetadata?: SessionMetadata;
}

import {formatTokenCount} from '../../utils/format';

/**
 * Activity indicator line. Always renders a single line to prevent layout shifts.
 * Shows spinner/status when active, empty line when idle.
 */
export function ActivityLine({runState, activeTurn, latestRuntimeEvent, sessionMetadata}: ActivityLineProps): React.JSX.Element {
  const status = useStatusIndicator({runState, activeTurn, latestRuntimeEvent});

  if (!status.banner) {
    // Render empty stable-height line to prevent layout jump
    return <Box height={1}><Text> </Text></Box>;
  }

  const lastTokens = sessionMetadata?.usage?.lastTotalTokens;
  const tokenSuffix = lastTokens && lastTokens > 0 && runState.status === 'running'
    ? ` (last call: ${formatTokenCount(lastTokens)} tok)`
    : '';

  return (
    <Box height={1}>
      <Text color={status.color}>{status.banner}{tokenSuffix}</Text>
    </Box>
  );
}

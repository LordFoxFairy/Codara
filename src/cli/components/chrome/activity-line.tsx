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

export function ActivityLine({runState, activeTurn, latestRuntimeEvent, sessionMetadata}: ActivityLineProps): React.JSX.Element | null {
  const status = useStatusIndicator({runState, activeTurn, latestRuntimeEvent});
  if (!status.banner) {
    return null;
  }

  const lastTokens = sessionMetadata?.usage?.lastTotalTokens;
  const tokenSuffix = lastTokens && lastTokens > 0 && runState.status === 'running'
    ? ` (last call: ${formatTokenCount(lastTokens)} tok)`
    : '';

  return (
    <Box>
      <Text color={status.color}>{status.banner}{tokenSuffix}</Text>
    </Box>
  );
}

import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent} from '@/index';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {useStatusIndicator} from '../../hooks/use-status-indicator';

interface ActivityLineProps {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
}

export function ActivityLine({runState, activeTurn, latestRuntimeEvent}: ActivityLineProps): React.JSX.Element | null {
  const status = useStatusIndicator({runState, activeTurn, latestRuntimeEvent});
  if (!status.banner) {
    return null;
  }

  return (
    <Box>
      <Text color={status.color}>{status.banner}</Text>
    </Box>
  );
}

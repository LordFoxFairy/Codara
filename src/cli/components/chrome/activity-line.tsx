import React from 'react';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {useStatusIndicator} from '../../hooks/use-status-indicator';

interface ActivityLineProps {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  hilBusy?: boolean;
}

export function ActivityLine({runState, activeTurn, hilBusy}: ActivityLineProps): React.JSX.Element | null {
  const status = useStatusIndicator({runState, activeTurn, hilBusy});
  if (!status.banner) {
    return null;
  }

  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={status.color}>{status.banner}</Text>
    </Box>
  );
}

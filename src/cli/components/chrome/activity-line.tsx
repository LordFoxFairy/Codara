import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent} from '@/index';
import type {SessionMetadata} from '@durability/session/types';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {useStatusIndicator} from '../../hooks/use-status-indicator';
import {formatTokenCount} from '../../utils/format';

interface ActivityLineProps {
  runState: CliRunState;
  activeTurn?: CliActiveTurn;
  latestRuntimeEvent?: CodaraRuntimeEvent;
  sessionMetadata?: SessionMetadata;
}

// 保持单行稳定高度，避免流式输出时界面上下抖动。
export function ActivityLine({runState, activeTurn, latestRuntimeEvent, sessionMetadata}: ActivityLineProps): React.JSX.Element {
  const status = useStatusIndicator({runState, activeTurn, latestRuntimeEvent});

  if (!status.banner) {
    return <Box height={1}><Text> </Text></Box>;
  }

  const streaming = activeTurn?.streamingTokens;
  let tokenSuffix = '';
  if (runState.status === 'running') {
    if (streaming && (streaming.input > 0 || streaming.output > 0)) {
      tokenSuffix = ` | ↑ ${formatTokenCount(streaming.input)} | ↓ ${formatTokenCount(streaming.output)}`;
    } else {
      const lastTokens = sessionMetadata?.usage?.lastTotalTokens;
      if (lastTokens && lastTokens > 0) {
        tokenSuffix = ` | last ${formatTokenCount(lastTokens)} tok`;
      }
    }
  }

  return (
    <Box height={1}>
      <Text color={status.color}>{status.banner}{tokenSuffix}</Text>
    </Box>
  );
}

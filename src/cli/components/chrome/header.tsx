import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent, SessionState} from '@core';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {CliRunState} from '../../app/view-state';
import {describeStatusIndicator} from '../../hooks/use-status-indicator';

interface HeaderProps {
  layoutMode: CliLayoutMode;
  session: SessionState;
  modelAlias: string;
  runState: CliRunState;
  latestRuntimeEvent?: CodaraRuntimeEvent;
}

function MetaRow({
  label,
  value,
  valueWrap = 'truncate-end',
}: {
  label: string;
  value: string;
  valueWrap?: 'truncate-end' | 'truncate-middle';
}): React.JSX.Element {
  return (
    <Box>
      <Box width={8} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap={valueWrap}>{value}</Text>
      </Box>
    </Box>
  );
}

export function Header(props: HeaderProps): React.JSX.Element {
  const {layoutMode, session, modelAlias, runState, latestRuntimeEvent} = props;
  const isMinimal = layoutMode === 'minimal';
  const title = session.metadata?.title?.trim() || 'Codara Code';
  const subtitle = session.metadata?.lastMessage?.trim() || 'Session ready for prompts';
  const messageCount = String(session.metadata?.messageCount ?? 0);
  const status = describeStatusIndicator({runState, latestRuntimeEvent});
  const contextWindow = session.metadata?.contextWindow;
  const contextUsage = contextWindow
    ? `${Math.round(contextWindow.usagePercent)}% (${contextWindow.estimatedInputTokens}/${contextWindow.maxInputTokens})`
    : 'n/a';

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text color="blueBright" wrap="truncate-end">
          {title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {subtitle}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <MetaRow label="Model" value={modelAlias} />
          <MetaRow label="Session" value={session.sessionId} valueWrap="truncate-middle" />
          {!isMinimal ? <MetaRow label="Msgs" value={messageCount} /> : null}
          <MetaRow label="Context" value={contextUsage} />
          <MetaRow label="Status" value={status.status} />
        </Box>
      </Box>
    </Box>
  );
}

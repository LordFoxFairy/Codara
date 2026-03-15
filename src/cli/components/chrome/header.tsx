import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent, SessionState} from '@core';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {CliRunState} from '../../app/view-state';
import {describeStatusIndicator} from '../../hooks/use-status-indicator';

interface StatusBarProps {
  layoutMode: CliLayoutMode;
  session: SessionState;
  cwd: string;
  modelAlias: string;
  runState: CliRunState;
  latestRuntimeEvent?: CodaraRuntimeEvent;
}

export interface StatusBarModel {
  subtitle: string;
  pathLine?: string;
}

export function describeStatusBar(props: StatusBarProps): StatusBarModel {
  const {layoutMode, session, cwd, modelAlias, runState, latestRuntimeEvent} = props;
  const isMinimal = layoutMode === 'minimal';
  const messageCount = session.metadata?.messageCount ?? 0;
  const status = describeStatusIndicator({runState, latestRuntimeEvent});
  const contextWindow = session.metadata?.contextWindow;
  const contextUsage = contextWindow
    ? `${Math.round(contextWindow.usagePercent)}%`
    : 'n/a';
  const sessionLabel = shortenSessionId(session.sessionId);

  return {
    subtitle: [
      modelAlias,
      sessionLabel,
      ...(!isMinimal ? [`${messageCount} msgs`] : []),
      `${contextUsage} ctx`,
      status.status.toLowerCase(),
    ].join('  ·  '),
    ...(!isMinimal ? {pathLine: cwd} : {}),
  };
}

function shortenSessionId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || 'unknown';
  }

  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function StatusBar(props: StatusBarProps): React.JSX.Element {
  const {layoutMode} = props;
  const model = describeStatusBar(props);

  if (layoutMode === 'minimal') {
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{model.subtitle}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor wrap="truncate-end">{model.subtitle}</Text>
      {model.pathLine ? <Text dimColor wrap="truncate-middle">{model.pathLine}</Text> : null}
    </Box>
  );
}

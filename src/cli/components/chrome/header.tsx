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

export interface HeaderModel {
  title: string;
  subtitle: string;
}

export function describeHeader(props: HeaderProps): HeaderModel {
  const {layoutMode, session, modelAlias, runState, latestRuntimeEvent} = props;
  const isMinimal = layoutMode === 'minimal';
  const title = session.metadata?.title?.trim() || 'Codara';
  const messageCount = session.metadata?.messageCount ?? 0;
  const status = describeStatusIndicator({runState, latestRuntimeEvent});
  const contextWindow = session.metadata?.contextWindow;
  const contextUsage = contextWindow
    ? `${Math.round(contextWindow.usagePercent)}%`
    : 'n/a';
  const sessionLabel = shortenSessionId(session.sessionId);

  return {
    title,
    subtitle: [
      modelAlias,
      sessionLabel,
      ...(!isMinimal ? [`${messageCount} msgs`] : []),
      `${contextUsage} ctx`,
      status.status.toLowerCase(),
    ].join('  ·  '),
  };
}

function shortenSessionId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || 'unknown';
  }

  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function Header(props: HeaderProps): React.JSX.Element {
  const model = describeHeader(props);

  return (
    <Box flexDirection="column">
      <Text color="blueBright" wrap="truncate-end">{model.title}</Text>
      <Text dimColor wrap="truncate-end">{model.subtitle}</Text>
    </Box>
  );
}

import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent, SessionState} from '@/index';
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

import {formatTokenCount} from '../../utils/format';


export function describeStatusBar(props: StatusBarProps): StatusBarModel {
  const {layoutMode, session, cwd, modelAlias, runState, latestRuntimeEvent} = props;
  const isMinimal = layoutMode === 'minimal';
  const messageCount = session.metadata?.messageCount ?? 0;
  const status = describeStatusIndicator({runState, latestRuntimeEvent});
  const contextWindow = session.metadata?.contextWindow;
  const usage = session.metadata?.usage;

  const segments: string[] = [modelAlias];

  if (!isMinimal) {
    segments.push(shortenSessionId(session.sessionId));
    segments.push(`${messageCount} msgs`);
  }

  // Context window usage: always show, default 0k/0k 0% when no data
  if (contextWindow) {
    const used = formatTokenCount(contextWindow.estimatedInputTokens);
    const cap = formatTokenCount(contextWindow.availableInputTokens);
    const pct = Math.round(contextWindow.usagePercent);
    const prefix = contextWindow.overBudget ? '⚠ ' : '';
    segments.push(`${prefix}${used}/${cap} ${pct}% ctx`);
  } else {
    segments.push('0k/0k 0% ctx');
  }

  // Token consumption: ↓prompt ↑completion (total)
  if (usage && usage.totalTokens > 0) {
    const total = formatTokenCount(usage.totalTokens);
    if (isMinimal) {
      segments.push(`${total} tok`);
    } else {
      segments.push(`↓${formatTokenCount(usage.promptTokens)} ↑${formatTokenCount(usage.completionTokens)} (${total})`);
    }
  }

  segments.push(status.status.toLowerCase());

  return {
    subtitle: segments.join('  ·  '),
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

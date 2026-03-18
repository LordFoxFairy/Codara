import React from 'react';
import {Box, Text} from 'ink';
import type {CodaraRuntimeEvent, SessionState} from '@/index';
import type {CliLayoutMode} from '../../app/layout-mode';
import type {CliRunState} from '../../app/view-state';
import {describeStatusIndicator} from '../../hooks/use-status-indicator';

export interface McpStatusSummary {
  connected: number;
  total: number;
}

interface StatusBarProps {
  layoutMode: CliLayoutMode;
  session: SessionState;
  cwd: string;
  modelAlias: string;
  runState: CliRunState;
  latestRuntimeEvent?: CodaraRuntimeEvent;
  mcpStatus?: McpStatusSummary;
  activeTeamCount?: number;
}

export interface StatusBarModel {
  subtitle: string;
  pathLine?: string;
}

import {formatTokenCount} from '../../utils/format';


export function describeStatusBar(props: StatusBarProps): StatusBarModel {
  const {layoutMode, session, cwd, modelAlias, runState, latestRuntimeEvent, mcpStatus, activeTeamCount} = props;
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

  // Active teams indicator
  if (activeTeamCount && activeTeamCount > 0) {
    segments.push(`${activeTeamCount} ${activeTeamCount === 1 ? 'team' : 'teams'}`);
  }

  // MCP indicator: show when servers are configured
  if (mcpStatus && mcpStatus.total > 0) {
    if (mcpStatus.connected === mcpStatus.total) {
      segments.push(`MCP:${mcpStatus.total}`);
    } else {
      segments.push(`MCP:${mcpStatus.connected}/${mcpStatus.total}`);
    }
  }

  // Context window usage: show full contextWindow as denominator (not available-after-output-reserve)
  if (contextWindow) {
    const used = formatTokenCount(contextWindow.estimatedInputTokens);
    const cap = formatTokenCount(contextWindow.maxInputTokens);
    const pct = Math.round(contextWindow.usagePercent);
    const prefix = contextWindow.overBudget ? '⚠ ' : '';
    segments.push(`${prefix}${used}/${cap} ${pct}% ctx`);
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

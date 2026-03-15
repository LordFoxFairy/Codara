import React from 'react';
import {Box, Text} from 'ink';
import type {SessionState} from '@/index';
import type {CliLayoutMode} from '../../app/layout-mode';

export interface RecentSession {
  sessionId: string;
  title?: string;
  timeAgo: string;
  messageCount: number;
}

const VERSION = '0.1.0';

export function deriveRecentSessions(sessions: SessionState[], now = Date.now()): RecentSession[] {
  return sessions.slice(0, 5).map((s) => ({
    sessionId: s.sessionId,
    title: s.metadata?.title,
    timeAgo: formatTimeAgo(s.metadata?.lastActivity ?? s.updatedAt, now),
    messageCount: s.metadata?.messageCount ?? 0,
  }));
}

function formatTimeAgo(timestamp: string, now: number): string {
  const diff = now - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/* ── Static variants: pure render, no hooks ── */

export interface StaticWelcomeProps {
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
  tip: string;
}

export function StaticWelcome({layoutMode, cwd, modelAlias, tip}: StaticWelcomeProps): React.JSX.Element {
  if (layoutMode === 'minimal') {
    return (
      <Text dimColor>Codara v{VERSION} · {modelAlias || 'default'} · /help for help</Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        <Text bold>{'\u2733'} Welcome to Codara v{VERSION}</Text>
        <Text> </Text>
        <Text dimColor>  /help for help</Text>
        <Text> </Text>
        <Text dimColor>  cwd: <Text dimColor wrap="truncate-end">{cwd || process.cwd()}</Text></Text>
        <Text dimColor>  model: {modelAlias || 'default'}</Text>
      </Box>
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Tip: {tip}</Text>
      </Box>
    </Box>
  );
}

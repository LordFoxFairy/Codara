import React from 'react';
import {Box, Text} from 'ink';
import type {SessionState} from '@/index';
import type {CliLayoutMode} from '../../app/layout-mode';
import {formatTimeAgo} from '../../utils/format';
import {theme} from '../../utils/theme';

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
      <Box borderStyle="round" borderColor={theme.chrome.border} flexDirection="column" paddingX={1}>
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

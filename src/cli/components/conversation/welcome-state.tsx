import React from 'react';
import {Box, Text} from 'ink';
import type {SessionState} from '@core';
import type {CliLayoutMode} from '../../app/layout-mode';
import {RobotMark} from '../chrome/robot-mark';

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

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId;
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

/* ── Static variants: pure render, no hooks ── */

export interface StaticWelcomeProps {
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
  recentSessions?: RecentSession[];
  tip: string;
  terminalWidth: number;
}

export function StaticWelcome({layoutMode, cwd, modelAlias, recentSessions, tip, terminalWidth}: StaticWelcomeProps): React.JSX.Element {
  if (layoutMode === 'minimal') {
    return (
      <Box marginTop={1}>
        <Text dimColor>Codara · {modelAlias || 'default'} · Ready</Text>
      </Box>
    );
  }

  if (layoutMode === 'compact') {
    return <StaticCompactWelcome cwd={cwd} modelAlias={modelAlias} tip={tip} terminalWidth={terminalWidth} />;
  }

  return <StaticWideWelcome cwd={cwd} modelAlias={modelAlias} recentSessions={recentSessions} tip={tip} />;
}

function StaticCompactWelcome({cwd, modelAlias, tip, terminalWidth}: {cwd?: string; modelAlias?: string; tip: string; terminalWidth: number}): React.JSX.Element {
  const availableWidth = Math.max(20, terminalWidth - 2);
  const titleText = ` Codara v${VERSION} `;
  const topRemaining = Math.max(0, availableWidth - 2 - titleText.length);
  const topLine = `──${titleText}${'─'.repeat(topRemaining)}`;
  const bottomLine = '─'.repeat(availableWidth);

  return (
    <Box flexDirection="column">
      <Text color="gray">{topLine}</Text>
      <Box flexDirection="column" paddingX={2} paddingY={1} alignItems="center">
        <Text bold color="white">Welcome back!</Text>
        <Box marginTop={1}>
          <RobotMark />
        </Box>
        {modelAlias ? <Text dimColor>{modelAlias}</Text> : null}
        {cwd ? <Text dimColor wrap="truncate-end">{cwd}</Text> : null}
      </Box>
      <Text color="gray">{bottomLine}</Text>
      <Box marginTop={1} flexDirection="column" paddingX={1}>
        <Text color="yellow" bold>Tip</Text>
        <Text dimColor>{tip}</Text>
      </Box>
    </Box>
  );
}

function StaticWideWelcome({cwd, modelAlias, recentSessions, tip}: {cwd?: string; modelAlias?: string; recentSessions?: RecentSession[]; tip: string}): React.JSX.Element {
  const hasRecent = recentSessions && recentSessions.length > 0;

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor="gray"
        flexDirection="row"
      >
        <Box
          flexDirection="column"
          width="42%"
          alignItems="center"
          paddingY={1}
          paddingX={1}
          borderStyle="round"
          borderColor="gray"
          borderRight
          borderLeft={false}
          borderTop={false}
          borderBottom={false}
        >
          <Text bold color="white">Welcome back!</Text>
          <Box marginTop={1}>
            <RobotMark />
          </Box>
          <Text dimColor>{modelAlias || 'default'}</Text>
          {cwd ? <Text dimColor wrap="truncate-end">{cwd}</Text> : null}
        </Box>

        <Box flexDirection="column" flexGrow={1} paddingY={1} paddingX={1}>
          <Text color="yellow" bold>Tips for getting started</Text>
          <Text dimColor wrap="truncate-end">{tip}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color="yellow" bold>Recent activity</Text>
            {hasRecent ? (
              recentSessions.map((s) => (
                <Box key={s.sessionId} gap={1}>
                  <Text dimColor>{truncateSessionId(s.sessionId)}</Text>
                  <Text wrap="truncate-end">{s.title || 'Untitled'}</Text>
                  <Text dimColor>{s.messageCount} msgs</Text>
                  <Text dimColor>{s.timeAgo}</Text>
                </Box>
              ))
            ) : (
              <Text dimColor>No recent activity</Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}


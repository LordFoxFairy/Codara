import React from 'react';
import { Box, Text } from 'ink';
import type { TeamSummary } from '../../hooks/use-team-dashboard.js';
import { theme } from '../../utils/theme.js';
import { formatTokenCount, formatTimeAgo } from '../../utils/format.js';

const STATUS_INDICATORS: Record<string, string> = {
  running: '●',
  paused: '◐',
  completing: '◑',
  completed: '✓',
  failed: '✗',
  created: '○',
  spawning: '◔',
  archived: '◌',
};

const STATUS_COLORS: Record<string, string> = {
  running: theme.status.responding,
  paused: theme.status.paused,
  completing: theme.role.system,
  completed: theme.chrome.dimmed,
  failed: theme.role.error,
  created: theme.chrome.dimmed,
  spawning: theme.status.running,
  archived: theme.chrome.dimmed,
};

const HEALTH_ICONS: Record<string, string> = {
  healthy: '♥',
  degraded: '♡',
  failing: '✗',
};

const HEALTH_COLORS: Record<string, string> = {
  healthy: theme.status.responding,
  degraded: theme.status.running,
  failing: theme.role.error,
};

interface TeamDashboardProps {
  teams: TeamSummary[];
}

export function TeamDashboard({ teams }: TeamDashboardProps) {
  if (teams.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
      <Text bold color="white">Teams</Text>
      {teams.map(team => (
        <TeamRow key={team.teamId} team={team} />
      ))}
      <Text dimColor>
        /team enter {'<name>'} to interact · /team list for details
      </Text>
    </Box>
  );
}

function TeamRow({ team }: { team: TeamSummary }) {
  const indicator = STATUS_INDICATORS[team.status] ?? '?';
  const color = STATUS_COLORS[team.status] ?? 'white';
  const healthIcon = HEALTH_ICONS[team.health] ?? '?';
  const healthColor = HEALTH_COLORS[team.health] ?? 'white';
  const ago = formatTimeAgo(team.lastActivity);

  return (
    <Box gap={1}>
      <Text color={color}>{indicator}</Text>
      <Text bold>{team.name.padEnd(20)}</Text>
      <Text dimColor>{`${team.progress.done}/${team.progress.total}`}</Text>
      <Text dimColor>{`${team.memberCount}m`}</Text>
      <Text color={healthColor}>{healthIcon}</Text>
      <Text dimColor>{formatTokenCount(team.tokenUsage)} tok</Text>
      <Text dimColor>{ago}</Text>
    </Box>
  );
}

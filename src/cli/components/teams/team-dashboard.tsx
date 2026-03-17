import React from 'react';
import { Box, Text } from 'ink';
import type { TeamSummary } from '../../hooks/use-team-dashboard.js';

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
  running: 'green',
  paused: 'yellow',
  completing: 'cyan',
  completed: 'gray',
  failed: 'red',
  created: 'gray',
  spawning: 'yellow',
};

interface TeamDashboardProps {
  teams: TeamSummary[];
}

export function TeamDashboard({ teams }: TeamDashboardProps) {
  if (teams.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
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

  return (
    <Box gap={1}>
      <Text color={color}>{indicator}</Text>
      <Text bold>{team.name.padEnd(20)}</Text>
      <Text>{`${team.progress.done}/${team.progress.total} jobs`}</Text>
      <Text dimColor>{`${team.memberCount} members`}</Text>
      <Text dimColor>{`↓${formatTokens(team.tokenUsage)}`}</Text>
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

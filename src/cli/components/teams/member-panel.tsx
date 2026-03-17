import React from 'react';
import { Box, Text } from 'ink';
import type { TeamMemberInfo } from '../../hooks/use-team-detail.js';

const ROLE_ICONS: Record<string, string> = {
  leader: '♚',
  worker: '♟',
  reviewer: '♜',
};

const STATUS_COLORS: Record<string, string> = {
  idle: 'gray',
  working: 'green',
  paused: 'yellow',
  terminated: 'red',
  initializing: 'cyan',
};

interface MemberPanelProps {
  members: TeamMemberInfo[];
}

export function MemberPanel({ members }: MemberPanelProps) {
  if (members.length === 0) return <Text dimColor>No members yet</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>Members</Text>
      {members.map(m => (
        <Box key={m.memberId} gap={1}>
          <Text>{ROLE_ICONS[m.role] ?? '?'}</Text>
          <Text bold>{m.name.padEnd(12)}</Text>
          <Text color={STATUS_COLORS[m.status] ?? 'white'}>{m.status.padEnd(10)}</Text>
          <Text dimColor>{m.model ?? 'default'}</Text>
          <Text dimColor>{formatTokens(m.tokens)} tokens</Text>
        </Box>
      ))}
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

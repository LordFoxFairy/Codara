import { Box, Text } from 'ink';
import type { TeamMemberInfo, TeamJobInfo } from '../../hooks/use-team-detail.js';
import { theme } from '../../utils/theme.js';
import { formatTokenCount } from '../../utils/format.js';

const ROLE_ICONS: Record<string, string> = {
  leader: '♚',
  worker: '♟',
  reviewer: '♜',
};

const STATUS_COLORS: Record<string, string> = {
  idle: theme.chrome.dimmed,
  coordinating: theme.status.running,
  working: theme.status.responding,
  paused: theme.status.paused,
  terminated: theme.role.error,
  initializing: theme.role.system,
  disconnected: theme.role.error,
  leaving: theme.chrome.dimmed,
};

/**
 * Derive the display status label for a member:
 * - leader + active job  → "coordinating"
 * - worker  + active job → "working"
 * - no job               → status as-is (idle / paused / terminated / initializing)
 */
function deriveStatusLabel(m: TeamMemberInfo): string {
  if (m.status === 'paused' || m.status === 'terminated' || m.status === 'initializing') {
    return m.status;
  }
  if (m.currentJobId) {
    return m.role === 'leader' ? 'coordinating' : 'working';
  }
  return 'idle';
}

interface MemberPanelProps {
  members: TeamMemberInfo[];
  jobs?: TeamJobInfo[];
  focusedMemberId?: string;
}

export function MemberPanel({ members, jobs = [], focusedMemberId }: MemberPanelProps) {
  if (members.length === 0) return <Text dimColor>No teammates yet</Text>;

  const jobMap = new Map(jobs.map(j => [j.id, j.title]));
  const leader = members.find((member) => member.role === 'leader');
  const workers = members.filter((member) => member.role !== 'leader');

  return (
    <Box flexDirection="column">
      <Text bold>Leader &amp; Teammates</Text>
      {leader ? (
        <Box gap={1}>
          <Text color={STATUS_COLORS[deriveStatusLabel(leader)] ?? 'white'}>{ROLE_ICONS.leader}</Text>
          <Text bold>{leader.name}</Text>
          <Text dimColor>leader</Text>
          <Text color={STATUS_COLORS[deriveStatusLabel(leader)] ?? 'white'}>{deriveStatusLabel(leader)}</Text>
          {leader.currentJobId && jobMap.get(leader.currentJobId) ? (
            <Text dimColor>→ {jobMap.get(leader.currentJobId)}</Text>
          ) : (
            <Text dimColor>receives your messages in this workspace</Text>
          )}
        </Box>
      ) : null}

      <Box marginTop={leader ? 1 : 0}>
        <Text bold>Teammates</Text>
      </Box>
      {workers.length === 0 ? <Text dimColor>No active teammates</Text> : workers.map(m => {
        const statusLabel = deriveStatusLabel(m);
        const statusColor = STATUS_COLORS[statusLabel] ?? 'white';
        const currentJobTitle = m.currentJobId ? jobMap.get(m.currentJobId) : undefined;

        return (
          <Box key={m.memberId} gap={1}>
            <Text color={theme.interactive.accent}>{m.memberId === focusedMemberId ? '▶' : ' '}</Text>
            <Text color={statusColor}>{ROLE_ICONS[m.role] ?? '?'}</Text>
            <Text bold>{m.name.padEnd(12)}</Text>
            <Text color={statusColor}>{statusLabel.padEnd(12)}</Text>
            {currentJobTitle ? (
              <Text dimColor>→ {currentJobTitle}</Text>
            ) : (
              <Text dimColor>{m.model ?? 'default'}</Text>
            )}
            {m.tokens > 0 ? <Text dimColor>{formatTokenCount(m.tokens)} tok</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

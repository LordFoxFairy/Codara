import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveTeam} from '../../hooks/use-active-teams';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';
import {formatElapsedMs} from '../../utils/format';
import {theme} from '../../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export interface TeamMemberInfo {
  name: string;
  role: string;
  status: string;
  currentJobId?: string;
  activity?: string;
  toolUseCount?: number;
  totalTokens?: string;
}

interface TeamPanelProps {
  teams: ActiveTeam[];
  runningCount: number;
  doneCount: number;
  errorCount: number;
  /** Optional member details per team (teamId -> members) */
  teamMembers?: Map<string, TeamMemberInfo[]>;
}

function buildTeamSummary(runningCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

type TeamDisplayStatus = 'running' | 'completed' | 'failed' | 'paused';

function resolveDisplayStatus(status: ActiveTeam['status']): TeamDisplayStatus {
  switch (status) {
    case 'running':
    case 'spawning':
    case 'completing':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'paused':
      return 'paused';
    default:
      return 'running';
  }
}

const TEAM_STATUS_COLOR: Record<TeamDisplayStatus, string> = {
  running: theme.status.running,
  completed: theme.status.done,
  failed: theme.status.error,
  paused: theme.status.paused,
};

function TeamIcon({status, frame}: {status: ActiveTeam['status']; frame: number}): React.JSX.Element {
  const displayStatus = resolveDisplayStatus(status);
  const color = TEAM_STATUS_COLOR[displayStatus];
  switch (displayStatus) {
    case 'running':
      return <Text color={color}>{BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length]}</Text>;
    case 'completed':
      return <Text color={color}>✓</Text>;
    case 'failed':
      return <Text color={color}>✕</Text>;
    case 'paused':
      return <Text color={color}>⏸</Text>;
  }
}

/** Derive display status for a member. */
function deriveMemberDisplayStatus(member: TeamMemberInfo): string {
  if (member.role === 'leader' && member.currentJobId) return 'coordinating';
  if (member.currentJobId) return 'working';
  if (member.activity) return member.activity;
  return member.status === 'idle' ? 'Idle' : member.status;
}

/** Color for member activity status. */
function memberStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower === 'working' || lower.startsWith('search') || lower.startsWith('read')) return theme.status.done;
  if (lower === 'coordinating') return theme.status.running;
  if (lower === 'paused') return theme.status.paused;
  return theme.chrome.dimmed;
}

/** Role display: leader shows name directly, worker shows @name. */
function formatMemberName(member: TeamMemberInfo): string {
  return member.role === 'leader' ? member.name : `@${member.name}`;
}

function MemberRow({member, isLast}: {
  member: TeamMemberInfo;
  isLast: boolean;
}): React.JSX.Element {
  const connector = isLast ? '└─' : '├─';
  const displayStatus = deriveMemberDisplayStatus(member);
  const statusColor = memberStatusColor(displayStatus);
  const name = formatMemberName(member);

  const statParts: string[] = [];
  if (member.toolUseCount) statParts.push(`${member.toolUseCount} tool uses`);
  if (member.totalTokens) statParts.push(`${member.totalTokens} tokens`);
  const stats = statParts.length > 0 ? ` · ${statParts.join(' · ')}` : '';

  return (
    <Box>
      <Text dimColor>{'  '}{connector} </Text>
      <Text color={statusColor}>{name}</Text>
      <Text dimColor>: </Text>
      <Text color={statusColor} wrap="truncate-end">{displayStatus}</Text>
      {stats && <Text dimColor>{stats}</Text>}
    </Box>
  );
}

function TeamRow({team, frame, members}: {
  team: ActiveTeam;
  frame: number;
  members?: TeamMemberInfo[];
}): React.JSX.Element {
  const progressParts: string[] = [];
  if (team.memberCount > 0) {
    progressParts.push(`${team.memberCount} member${team.memberCount !== 1 ? 's' : ''}`);
  }
  if (team.jobProgress.total > 0) {
    progressParts.push(`${team.jobProgress.done}/${team.jobProgress.total} jobs`);
  }
  const statSuffix = progressParts.length > 0 ? `  ${progressParts.join(' · ')}` : '';

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <TeamIcon status={team.status} frame={frame} />
        <Text bold wrap="truncate-end">{team.name}</Text>
        {team.goal ? <Text dimColor wrap="truncate-end">{team.goal}</Text> : null}
        <Text dimColor>{formatElapsedMs(team.elapsed)}{statSuffix}</Text>
      </Box>
      {members && members.length > 0 && members.map((member, idx) => (
        <MemberRow
          key={member.name}
          member={member}
          isLast={idx === members.length - 1}
        />
      ))}
    </Box>
  );
}

export function TeamPanel({teams, runningCount, doneCount, errorCount, teamMembers}: TeamPanelProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runningCount === 0) return;

    const timer = setInterval(() => {
      setFrame(current => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runningCount]);

  if (teams.length === 0) return null;

  const summary = buildTeamSummary(runningCount, doneCount, errorCount);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.chrome.border} paddingX={1}>
      <Text dimColor bold>Teams ({summary})</Text>
      {teams.map((team) => (
        <TeamRow
          key={team.teamId}
          team={team}
          frame={frame}
          members={teamMembers?.get(team.teamId)}
        />
      ))}
    </Box>
  );
}

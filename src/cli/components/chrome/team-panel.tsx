import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveTeam} from '../../hooks/use-active-teams';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';
import {formatElapsedMs} from '../../utils/format';
import {theme} from '../../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Maximum characters for team name column before truncation. */
const TEAM_NAME_MAX_WIDTH = 24;

/** Maximum characters for goal column before truncation. */
const TEAM_GOAL_MAX_WIDTH = 28;

export interface TeamMemberInfo {
  name: string;
  role: string;
  status: string;
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

const TEAM_STATUS_LABEL: Record<TeamDisplayStatus, string> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  paused: 'paused',
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

function TeamStatusText({status}: {status: ActiveTeam['status']}): React.JSX.Element {
  const displayStatus = resolveDisplayStatus(status);
  return <Text color={TEAM_STATUS_COLOR[displayStatus]}>{TEAM_STATUS_LABEL[displayStatus]}</Text>;
}

const MAX_VISIBLE_MEMBERS = 6;

/** Role icon: ♚ for leader, ♟ for worker. */
function memberRoleIcon(role: string): string {
  return role === 'leader' ? '♚' : '♟';
}

/** Color for member activity status. */
function memberStatusColor(status: string): string {
  switch (status) {
    case 'working': return theme.status.done;        // green
    case 'coordinating': return theme.status.running; // yellow
    case 'paused': return theme.status.paused;        // blueBright
    case 'idle':
    default: return theme.chrome.dimmed;              // gray
  }
}

function MemberPair({members}: {members: TeamMemberInfo[]}): React.JSX.Element {
  const [left, right] = members;
  return (
    <Box gap={2}>
      <Text>{'  '}</Text>
      {left && (
        <Box gap={1}>
          <Text color={memberStatusColor(left.status)}>{memberRoleIcon(left.role)}</Text>
          <Text dimColor>{left.name.slice(0, 12).padEnd(12)}</Text>
          <Text color={memberStatusColor(left.status)}>{left.status.slice(0, 12).padEnd(12)}</Text>
        </Box>
      )}
      {right && (
        <Box gap={1}>
          <Text color={memberStatusColor(right.status)}>{memberRoleIcon(right.role)}</Text>
          <Text dimColor>{right.name.slice(0, 12).padEnd(12)}</Text>
          <Text color={memberStatusColor(right.status)}>{right.status.slice(0, 12)}</Text>
        </Box>
      )}
    </Box>
  );
}

function TeamMemberRows({members}: {members: TeamMemberInfo[]}): React.JSX.Element {
  const visible = members.slice(0, MAX_VISIBLE_MEMBERS);
  const overflow = members.length - MAX_VISIBLE_MEMBERS;
  const pairs: Array<[TeamMemberInfo, TeamMemberInfo | undefined]> = [];
  for (let i = 0; i < visible.length; i += 2) {
    pairs.push([visible[i]!, visible[i + 1]]);
  }
  return (
    <>
      {pairs.map((pair, idx) => (
        <MemberPair key={idx} members={pair.filter((m): m is TeamMemberInfo => m !== undefined)} />
      ))}
      {overflow > 0 && (
        <Box>
          <Text>{'  '}</Text>
          <Text dimColor>+{overflow} more</Text>
        </Box>
      )}
    </>
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
      {teams.map(team => {
        const name = team.name.slice(0, TEAM_NAME_MAX_WIDTH).padEnd(TEAM_NAME_MAX_WIDTH);
        const goal = team.goal.slice(0, TEAM_GOAL_MAX_WIDTH);
        const progressParts: string[] = [];
        if (team.memberCount > 0) {
          progressParts.push(`${team.memberCount} member${team.memberCount !== 1 ? 's' : ''}`);
        }
        if (team.jobProgress.total > 0) {
          progressParts.push(`${team.jobProgress.done}/${team.jobProgress.total} jobs`);
        }
        const statSuffix = progressParts.length > 0 ? `  ${progressParts.join(' · ')}` : '';
        const members = teamMembers?.get(team.teamId);
        return (
          <Box key={team.teamId} flexDirection="column">
            <Box gap={1}>
              <TeamIcon status={team.status} frame={frame} />
              <Text wrap="truncate-end">{name}</Text>
              {goal ? <Text dimColor wrap="truncate-end">{goal}</Text> : null}
              <TeamStatusText status={team.status} />
              <Text dimColor>{formatElapsedMs(team.elapsed)}{statSuffix}</Text>
            </Box>
            {members && members.length > 0 && <TeamMemberRows members={members} />}
          </Box>
        );
      })}
    </Box>
  );
}

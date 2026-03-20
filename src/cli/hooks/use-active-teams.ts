import {useEffect, useMemo, useState} from 'react';
import type {CodaraRuntimeEvent, TeamQuerySummary} from '@/index';
import type {TeamStatus} from '@capability/team/coordination/types';

export type {TeamQuerySummary};

export interface ActiveTeam {
  teamId: string;
  name: string;
  status: TeamStatus;
  goal: string;
  memberCount: number;
  jobProgress: {done: number; total: number};
  startedAt: number;
  completedAt?: number;
  elapsed: number;
}

export interface UseActiveTeamsInput {
  teamSummaries: readonly TeamQuerySummary[];
  runtimeEvents?: readonly CodaraRuntimeEvent[];
}

export interface MemberActivity {
  memberId: string;
  activity: string;
  timestamp: number;
}

export interface UseActiveTeamsOutput {
  activeTeams: ActiveTeam[];
  hasActiveTeams: boolean;
  runningCount: number;
  doneCount: number;
  errorCount: number;
  /** Latest tool activity per member (memberId -> activity label). */
  memberActivities: Map<string, string>;
}

export interface ActiveTeamSnapshot {
  activeTeams: ActiveTeam[];
  runningCount: number;
  doneCount: number;
  errorCount: number;
}

const MAX_VISIBLE_TEAMS = 3;
const DONE_TEAM_LINGER_MS = 5000;

export function deriveActiveTeams(
  summaries: readonly TeamQuerySummary[],
  now: number,
): ActiveTeam[] {
  return deriveActiveTeamSnapshot(summaries, now).activeTeams;
}

export function deriveActiveTeamSnapshot(
  summaries: readonly TeamQuerySummary[],
  now: number,
): ActiveTeamSnapshot {
  const teams: ActiveTeam[] = [];

  for (const summary of summaries) {
    const status = normalizeTeamStatus(summary.status);
    if (!isVisibleTeamStatus(status)) {
      continue;
    }

    const startedAt = Date.parse(summary.startedAt);
    const completedAt = summary.completedAt ? Date.parse(summary.completedAt) : undefined;
    const terminalAt = resolveTerminalAt(startedAt, completedAt, now);

    if ((status === 'completed' || status === 'failed') && now - terminalAt > DONE_TEAM_LINGER_MS) {
      continue;
    }

    teams.push({
      teamId: summary.teamId,
      name: summary.name,
      status,
      goal: summary.goal,
      memberCount: summary.memberCount,
      jobProgress: summary.jobProgress,
      startedAt,
      completedAt,
      elapsed:
        status === 'completed' || status === 'failed'
          ? (terminalAt === startedAt ? now - startedAt : terminalAt - startedAt)
          : now - startedAt,
    });
  }

  teams.sort((a, b) => {
    const aPriority = teamSortPriority(a.status);
    const bPriority = teamSortPriority(b.status);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.startedAt - a.startedAt;
  });

  const runningCount = teams.filter((team) => (
    team.status === 'running' || team.status === 'spawning' || team.status === 'completing'
  )).length;
  const doneCount = teams.filter((team) => team.status === 'completed').length;
  const errorCount = teams.filter((team) => team.status === 'failed').length;

  return {
    activeTeams: teams.slice(0, MAX_VISIBLE_TEAMS),
    runningCount,
    doneCount,
    errorCount,
  };
}

/**
 * Extract the latest tool activity per member from runtime events.
 * Parses detail format: "member.activity:<memberId>:<activity>"
 */
export function deriveMemberActivities(events: readonly CodaraRuntimeEvent[]): Map<string, string> {
  const activities = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 'team' || event.phase !== 'update') continue;
    const detail = event.detail;
    if (!detail?.startsWith('member.activity:')) continue;
    const rest = detail.slice('member.activity:'.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx <= 0) continue;
    const memberId = rest.slice(0, colonIdx);
    const activity = rest.slice(colonIdx + 1);
    activities.set(memberId, activity);
  }
  return activities;
}

export function useActiveTeams(input: UseActiveTeamsInput): UseActiveTeamsOutput {
  const [now, setNow] = useState(() => Date.now());
  const snapshot = useMemo(() => deriveActiveTeamSnapshot(input.teamSummaries, now), [input.teamSummaries, now]);
  const {activeTeams, runningCount, doneCount, errorCount} = snapshot;
  const memberActivities = useMemo(() => deriveMemberActivities(input.runtimeEvents ?? []), [input.runtimeEvents]);

  useEffect(() => {
    if (runningCount === 0 && activeTeams.length === 0) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [runningCount, activeTeams.length]);

  return {
    activeTeams,
    hasActiveTeams: activeTeams.length > 0,
    runningCount,
    doneCount,
    errorCount,
    memberActivities,
  };
}

function normalizeTeamStatus(status: string): TeamStatus {
  switch (status) {
    case 'created':
      return 'created';
    case 'spawning':
      return 'spawning';
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'completing':
      return 'completing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'archived':
      return 'archived';
    default:
      return 'running';
  }
}

function isVisibleTeamStatus(status: TeamStatus): boolean {
  return status !== 'archived' && status !== 'created';
}

function teamSortPriority(status: TeamStatus): number {
  switch (status) {
    case 'running':
    case 'spawning':
    case 'completing':
      return 0;
    case 'paused':
      return 1;
    case 'completed':
    case 'failed':
      return 2;
    default:
      return 3;
  }
}

function resolveTerminalAt(startedAt: number, completedAt: number | undefined, now: number): number {
  if (completedAt === undefined || !Number.isFinite(completedAt)) {
    return startedAt;
  }

  if (completedAt < startedAt || completedAt > now) {
    return startedAt;
  }

  return completedAt;
}

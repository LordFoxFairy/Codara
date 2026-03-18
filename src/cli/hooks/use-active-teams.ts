import {useEffect, useMemo, useState} from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {TeamStatus} from '@capability/team/coordination/types';

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
  runtimeEvents: readonly CodaraRuntimeEvent[];
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

const MAX_VISIBLE_TEAMS = 3;
const DONE_TEAM_LINGER_MS = 5000;

/**
 * Parse a team start/end label to extract metadata.
 * Expected label format for start: "Team <name>: <goal>"
 * Expected detail format for start: "memberCount:<n> jobTotal:<n>"
 * Expected detail format for end:   "done:<n> total:<n> [tokens:<n>]"
 */
function parseTeamStartEvent(event: CodaraRuntimeEvent): {name: string; goal: string; memberCount: number; jobTotal: number} {
  const label = event.label ?? '';
  const detail = event.detail ?? '';

  // Label: "Team frontend-refactor: Implement the frontend"
  const labelMatch = label.match(/^Team\s+([^:]+?)(?::\s+(.*))?$/);
  const name = labelMatch?.[1]?.trim() ?? label.slice(0, 30);
  const goal = labelMatch?.[2]?.trim() ?? '';

  const memberMatch = detail.match(/memberCount:(\d+)/);
  const jobMatch = detail.match(/jobTotal:(\d+)/);
  const memberCount = memberMatch ? Number(memberMatch[1]) : 0;
  const jobTotal = jobMatch ? Number(jobMatch[1]) : 0;

  return {name, goal, memberCount, jobTotal};
}

function parseTeamEndDetail(detail?: string): {done: number; total: number} {
  if (!detail) return {done: 0, total: 0};
  const doneMatch = detail.match(/done:(\d+)/);
  const totalMatch = detail.match(/total:(\d+)/);
  return {
    done: doneMatch ? Number(doneMatch[1]) : 0,
    total: totalMatch ? Number(totalMatch[1]) : 0,
  };
}

function mapTeamStatus(event: CodaraRuntimeEvent): TeamStatus {
  if (event.status === 'error') return 'failed';
  if (event.status === 'paused') return 'paused';
  if (event.status === 'done') return 'completed';
  return 'running';
}

export function deriveActiveTeams(
  events: readonly CodaraRuntimeEvent[],
  now: number,
): ActiveTeam[] {
  const teamStarts = new Map<string, CodaraRuntimeEvent>();
  const teamEnds = new Map<string, CodaraRuntimeEvent>();

  for (const event of events) {
    if (event.kind !== 'team') continue;
    if (event.phase === 'start') {
      teamStarts.set(event.id, event);
    } else if (event.phase === 'end' && event.parentId) {
      teamEnds.set(event.parentId, event);
    }
  }

  const teams: ActiveTeam[] = [];

  for (const [id, startEvent] of teamStarts) {
    const endEvent = teamEnds.get(id);
    const startedAt = Date.parse(startEvent.timestamp);
    const completedAt = endEvent ? Date.parse(endEvent.timestamp) : undefined;

    const status: TeamStatus = endEvent ? mapTeamStatus(endEvent) : 'running';

    // Remove completed/failed teams after linger period
    if ((status === 'completed' || status === 'failed') && completedAt && now - completedAt > DONE_TEAM_LINGER_MS) {
      continue;
    }

    const {name, goal, memberCount, jobTotal} = parseTeamStartEvent(startEvent);
    const {done: jobsDone, total: jobsTotal} = endEvent
      ? parseTeamEndDetail(endEvent.detail)
      : {done: 0, total: jobTotal};

    teams.push({
      teamId: id,
      name,
      status,
      goal,
      memberCount,
      jobProgress: {done: jobsDone, total: jobsTotal},
      startedAt,
      completedAt,
      elapsed: (completedAt ?? now) - startedAt,
    });
  }

  // Running first, then by start time descending
  teams.sort((a, b) => {
    const aRunning = a.status === 'running' || a.status === 'spawning' ? 0 : 1;
    const bRunning = b.status === 'running' || b.status === 'spawning' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.startedAt - a.startedAt;
  });

  return teams.slice(0, MAX_VISIBLE_TEAMS);
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
  const activeTeams = useMemo(() => deriveActiveTeams(input.runtimeEvents, now), [input.runtimeEvents, now]);
  const runningCount = useMemo(
    () => activeTeams.filter(t => t.status === 'running' || t.status === 'spawning').length,
    [activeTeams],
  );
  const doneCount = useMemo(() => activeTeams.filter(t => t.status === 'completed').length, [activeTeams]);
  const errorCount = useMemo(() => activeTeams.filter(t => t.status === 'failed').length, [activeTeams]);
  const memberActivities = useMemo(() => deriveMemberActivities(input.runtimeEvents), [input.runtimeEvents]);

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

import {describe, expect, it} from 'bun:test';
import {
  deriveActiveTeamSnapshot,
  deriveActiveTeams,
  deriveMemberActivities,
  type TeamQuerySummary,
} from '@/cli/hooks/use-active-teams';

function createTeamSummary(overrides: Partial<TeamQuerySummary>): TeamQuerySummary {
  return {
    teamId: 'team-1',
    name: 'frontend',
    status: 'running',
    goal: 'Build UI',
    memberCount: 3,
    jobProgress: {done: 1, total: 5},
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('deriveActiveTeams', () => {
  const baseTime = Date.parse('2026-03-16T00:00:00Z');

  it('derives running teams from stable summaries', () => {
    const teams = deriveActiveTeams([
      createTeamSummary({
        teamId: 'team-frontend',
        startedAt: new Date(baseTime).toISOString(),
      }),
    ], baseTime + 5000);

    expect(teams).toHaveLength(1);
    expect(teams[0]).toEqual(expect.objectContaining({
      teamId: 'team-frontend',
      status: 'running',
      name: 'frontend',
      goal: 'Build UI',
      memberCount: 3,
    }));
    expect(teams[0]!.elapsed).toBe(5000);
  });

  it('keeps completed teams during linger window, then hides them', () => {
    const summaries = [
      createTeamSummary({
        status: 'completed',
        startedAt: new Date(baseTime).toISOString(),
        completedAt: new Date(baseTime + 1000).toISOString(),
      }),
    ];

    expect(deriveActiveTeams(summaries, baseTime + 2000)).toHaveLength(1);
    expect(deriveActiveTeams(summaries, baseTime + 8000)).toHaveLength(0);
  });

  it('keeps failed teams visible during linger even without completedAt', () => {
    const summaries = [
      createTeamSummary({
        status: 'failed',
        startedAt: new Date(baseTime).toISOString(),
      }),
    ];

    expect(deriveActiveTeams(summaries, baseTime + 4000)).toHaveLength(1);
    expect(deriveActiveTeams(summaries, baseTime + 6000)).toHaveLength(0);
  });

  it('falls back to startedAt when terminal timestamps are inconsistent', () => {
    const summaries = [
      createTeamSummary({
        status: 'failed',
        startedAt: new Date(baseTime).toISOString(),
        completedAt: new Date(baseTime - 6000).toISOString(),
      }),
    ];

    expect(deriveActiveTeams(summaries, baseTime + 2000)).toHaveLength(1);
  });

  it('sorts running teams before completed teams and limits to 3', () => {
    const summaries = [
      createTeamSummary({
        teamId: 'done',
        name: 'done',
        status: 'completed',
        startedAt: new Date(baseTime).toISOString(),
        completedAt: new Date(baseTime + 1000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'run-1',
        name: 'run-1',
        startedAt: new Date(baseTime + 2000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'run-2',
        name: 'run-2',
        startedAt: new Date(baseTime + 3000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'run-3',
        name: 'run-3',
        startedAt: new Date(baseTime + 4000).toISOString(),
      }),
    ];

    const teams = deriveActiveTeams(summaries, baseTime + 5000);
    expect(teams).toHaveLength(3);
    expect(teams[0]!.status).toBe('running');
    expect(teams[1]!.status).toBe('running');
    expect(teams[2]!.status).toBe('running');
  });

  it('counts all matching teams even when visible rows are capped', () => {
    const summaries = [
      createTeamSummary({
        teamId: 'run-1',
        name: 'run-1',
        startedAt: new Date(baseTime + 4000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'run-2',
        name: 'run-2',
        startedAt: new Date(baseTime + 3000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'run-3',
        name: 'run-3',
        startedAt: new Date(baseTime + 2000).toISOString(),
      }),
      createTeamSummary({
        teamId: 'done-1',
        name: 'done-1',
        status: 'completed',
        startedAt: new Date(baseTime + 1000).toISOString(),
        completedAt: new Date(baseTime + 2500).toISOString(),
      }),
      createTeamSummary({
        teamId: 'error-1',
        name: 'error-1',
        status: 'failed',
        startedAt: new Date(baseTime).toISOString(),
        completedAt: new Date(baseTime + 2000).toISOString(),
      }),
    ];

    const snapshot = deriveActiveTeamSnapshot(summaries, baseTime + 6000);
    expect(snapshot.activeTeams).toHaveLength(3);
    expect(snapshot.runningCount).toBe(3);
    expect(snapshot.doneCount).toBe(1);
    expect(snapshot.errorCount).toBe(1);
  });
});

describe('deriveMemberActivities', () => {
  const baseTime = Date.parse('2026-03-16T00:00:00Z');

  it('keeps the latest activity per member from runtime events', () => {
    const activities = deriveMemberActivities([
      {
        id: 'evt-1',
        sessionId: 'session-1',
        timestamp: new Date(baseTime).toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'member activity',
        detail: 'member.activity:member-1:read_file(src/a.ts)',
      },
      {
        id: 'evt-2',
        sessionId: 'session-1',
        timestamp: new Date(baseTime + 1000).toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'member activity',
        detail: 'member.activity:member-1:write_file(src/b.ts)',
      },
    ]);

    expect(activities.get('member-1')).toBe('write_file(src/b.ts)');
  });
});

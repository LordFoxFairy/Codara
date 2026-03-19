import {describe, expect, it} from 'bun:test';
import {deriveTeamPanelState} from '../../../src/cli/hooks/use-team-panel-state';
import type {UseActiveTeamsOutput} from '../../../src/cli/hooks/use-active-teams';

describe('deriveTeamPanelState', () => {
  it('uses team detail to build display teams and member rows without mutating source teams', () => {
    const sourceTeams: UseActiveTeamsOutput = {
      activeTeams: [{
        teamId: 'team-1',
        name: 'event-name',
        status: 'running',
        goal: '',
        memberCount: 0,
        jobProgress: {done: 0, total: 2},
        startedAt: 1,
        elapsed: 1000,
      }],
      hasActiveTeams: true,
      runningCount: 1,
      doneCount: 0,
      errorCount: 0,
      memberActivities: new Map([['member-1', 'searching code']]),
    };

    const originalName = sourceTeams.activeTeams[0]?.name;
    const originalGoal = sourceTeams.activeTeams[0]?.goal;
    const originalMemberCount = sourceTeams.activeTeams[0]?.memberCount;

    const result = deriveTeamPanelState({
      codara: {
        getTeamDetail(target) {
          if (target !== 'event-name' && target !== 'team-1') {
            return undefined;
          }
          return {
            teamId: 'registry-team-1',
            name: 'authoritative-name',
            status: 'running',
            goal: 'Ship the refactor',
            members: [{
              memberId: 'member-1',
              name: 'alice',
              role: 'worker',
              status: 'running',
              model: 'default',
              currentJobId: 'job-1',
            }],
            jobs: [{
              id: 'job-1',
              title: 'Refactor panel',
              status: 'running',
              assignee: 'alice',
              blockedBy: [],
            }],
          };
        },
      },
      activeTeams: sourceTeams,
    });

    expect(result.teams[0]?.name).toBe('authoritative-name');
    expect(result.teams[0]?.goal).toBe('Ship the refactor');
    expect(result.teams[0]?.memberCount).toBe(1);
    expect(result.teamMembers?.get('team-1')?.[0]).toEqual({
      name: 'alice',
      role: 'worker',
      status: 'running',
      currentJobId: 'job-1',
      activity: 'searching code',
    });

    expect(sourceTeams.activeTeams[0]?.name).toBe(originalName);
    expect(sourceTeams.activeTeams[0]?.goal).toBe(originalGoal);
    expect(sourceTeams.activeTeams[0]?.memberCount).toBe(originalMemberCount);
  });

  it('falls back to runtime team data when no detail is available', () => {
    const sourceTeams: UseActiveTeamsOutput = {
      activeTeams: [{
        teamId: 'team-2',
        name: 'runtime-team',
        status: 'paused',
        goal: 'Keep current state',
        memberCount: 2,
        jobProgress: {done: 1, total: 3},
        startedAt: 1,
        elapsed: 2000,
      }],
      hasActiveTeams: true,
      runningCount: 0,
      doneCount: 0,
      errorCount: 0,
      memberActivities: new Map(),
    };

    const result = deriveTeamPanelState({
      codara: {
        getTeamDetail() {
          return undefined;
        },
      },
      activeTeams: sourceTeams,
    });

    expect(result.teams).toEqual(sourceTeams.activeTeams);
    expect(result.teamMembers).toBeUndefined();
  });
});

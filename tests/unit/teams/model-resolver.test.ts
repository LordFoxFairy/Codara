import { describe, test, expect } from 'bun:test';
import { resolveModel } from '@capability/team/runtime/model-resolver';
import type { TeamMember, Team } from '@capability/team/types';

// Helper to create minimal test objects
function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    memberId: 'mem_1', name: 'test', teamId: 'team_1',
    role: 'worker', status: 'idle', sessionId: 's1',
    mode: 'local', joinedAt: new Date().toISOString(), ...overrides,
  };
}

function makeTeam(cascade: Record<string, string | undefined> = {}): Team {
  return {
    teamId: 'team_1', name: 'test', rootTeamId: 'team_1',
    status: 'running', goal: 'test', createdBy: 'user', depth: 0,
    config: {
      maxDepth: 2, allowSubTeams: true, maxMembers: 10,
      modelCascade: cascade as any, worktreeStrategy: 'per-agent', autoShutdown: true,
    },
    createdAt: new Date().toISOString(),
  };
}

describe('resolveModel', () => {
  test('member override takes highest priority', () => {
    const member = makeMember({ model: 'member-model', role: 'worker' });
    const team = makeTeam({ worker: 'role-model', default: 'team-model' });
    expect(resolveModel(member, team, 'global-model')).toBe('member-model');
  });

  test('falls back to role default when no member override', () => {
    const member = makeMember({ role: 'worker' });
    const team = makeTeam({ worker: 'role-model', default: 'team-model' });
    expect(resolveModel(member, team, 'global-model')).toBe('role-model');
  });

  test('falls back to team default when no role match', () => {
    const member = makeMember({ role: 'reviewer' });
    const team = makeTeam({ worker: 'role-model', default: 'team-model' });
    expect(resolveModel(member, team, 'global-model')).toBe('team-model');
  });

  test('falls back to global default when no team config', () => {
    const member = makeMember({ role: 'reviewer' });
    const team = makeTeam({});
    expect(resolveModel(member, team, 'global-model')).toBe('global-model');
  });

  test('leader role uses leader cascade', () => {
    const member = makeMember({ role: 'leader' });
    const team = makeTeam({ leader: 'opus', worker: 'sonnet' });
    expect(resolveModel(member, team, 'fallback')).toBe('opus');
  });
});

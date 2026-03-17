import { describe, test, expect } from 'bun:test';
import { canCreateSubTeam, canSpawnMember } from '@capability/team/security/depth-control';
import type { Team } from '@capability/team/types';
import { SECURITY_DEFAULTS } from '@capability/team/types';

function makeTeam(overrides: Partial<Team> & { depth: number; config: Team['config'] }): Team {
  return {
    teamId: 'team-1',
    name: 'Test Team',
    rootTeamId: 'team-1',
    status: 'running',
    goal: 'test',
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const baseConfig: Team['config'] = {
  maxDepth: 2,
  allowSubTeams: true,
  maxMembers: 10,
  modelCascade: {},
  autoShutdown: true,
};

describe('canCreateSubTeam', () => {
  test('true within depth limit + allowSubTeams', () => {
    const team = makeTeam({ depth: 1, config: { ...baseConfig, maxDepth: 2, allowSubTeams: true } });
    expect(canCreateSubTeam(team)).toBe(true);
  });

  test('false at max depth', () => {
    const team = makeTeam({ depth: 2, config: { ...baseConfig, maxDepth: 2, allowSubTeams: true } });
    expect(canCreateSubTeam(team)).toBe(false);
  });

  test('false when allowSubTeams=false', () => {
    const team = makeTeam({ depth: 0, config: { ...baseConfig, maxDepth: 2, allowSubTeams: false } });
    expect(canCreateSubTeam(team)).toBe(false);
  });
});

describe('canSpawnMember', () => {
  test('true when under limits', () => {
    expect(canSpawnMember(3, 10, 5)).toBe(true);
  });

  test('false when team full', () => {
    expect(canSpawnMember(10, 10, 5)).toBe(false);
  });

  test('false when global limit reached', () => {
    expect(canSpawnMember(3, 10, SECURITY_DEFAULTS.maxTotalAgents)).toBe(false);
  });
});

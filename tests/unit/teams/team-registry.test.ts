import {describe, expect, test, beforeEach} from 'bun:test';
import {TeamRegistry, TeamRegistryError} from '@capability/team/coordination/team-registry';
import {SECURITY_DEFAULTS} from '@capability/team/coordination/types';
import type {TeamMember, TeamStatus} from '@capability/team/coordination/types';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeMember(overrides: Partial<TeamMember> & {memberId: string; teamId: string}): TeamMember {
  return {
    name: overrides.memberId,
    role: 'worker',
    status: 'idle',
    sessionId: `session_${overrides.memberId}`,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('TeamRegistry', () => {
  let registry: TeamRegistry;

  beforeEach(() => {
    registry = new TeamRegistry();
  });

  // ── createTeam ─────────────────────────────────────────────────────

  describe('createTeam', () => {
    test('generates ID with team_ prefix', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'Build it'});
      expect(team.teamId).toStartWith('team_');
      expect(team.teamId.length).toBeGreaterThan(5);
    });

    test('sets correct defaults', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'Build it'});
      expect(team.status).toBe('created');
      expect(team.depth).toBe(0);
      expect(team.rootTeamId).toBe(team.teamId);
      expect(team.createdBy).toBe('user');
      expect(team.config.maxDepth).toBe(1);
      expect(team.config.allowSubTeams).toBe(false);
      expect(team.config.maxMembers).toBe(10);
      expect(team.config.autoShutdown).toBe(true);
    });

    test('applies custom config', () => {
      const team = registry.createTeam({
        name: 'Alpha',
        goal: 'Build it',
        config: {maxMembers: 5, allowSubTeams: false},
      });
      expect(team.config.maxMembers).toBe(5);
      expect(team.config.allowSubTeams).toBe(false);
    });

    test('creates a job board for the team', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'Build it'});
      const board = registry.getJobBoard(team.teamId);
      expect(board).toBeDefined();
      expect(board.teamId).toBe(team.teamId);
    });

    test('uses custom createdBy', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'Build it', createdBy: 'agent_1'});
      expect(team.createdBy).toBe('agent_1');
    });
  });

  // ── Name Uniqueness ────────────────────────────────────────────────

  describe('createTeam name uniqueness', () => {
    test('rejects duplicate names for active teams', () => {
      registry.createTeam({name: 'Alpha', goal: 'G1'});
      expect(() => registry.createTeam({name: 'Alpha', goal: 'G2'})).toThrow(
        TeamRegistryError,
      );
    });

    test('allows duplicate name after team is archived', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'G1'});
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'running');
      registry.updateTeamStatus(team.teamId, 'completing');
      registry.updateTeamStatus(team.teamId, 'completed');
      registry.updateTeamStatus(team.teamId, 'archived');

      const team2 = registry.createTeam({name: 'Alpha', goal: 'G2'});
      expect(team2.teamId).not.toBe(team.teamId);
    });

    test('allows duplicate name after team failed', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'G1'});
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'failed');

      const team2 = registry.createTeam({name: 'Alpha', goal: 'G2'});
      expect(team2.teamId).not.toBe(team.teamId);
    });
  });

  // ── getTeam / getTeamByName / listTeams ────────────────────────────

  describe('lookups', () => {
    test('getTeam returns the team by ID', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'G'});
      expect(registry.getTeam(team.teamId)).toBe(team);
    });

    test('getTeam returns undefined for missing ID', () => {
      expect(registry.getTeam('nonexistent')).toBeUndefined();
    });

    test('getTeamByName finds team by name', () => {
      const team = registry.createTeam({name: 'Alpha', goal: 'G'});
      expect(registry.getTeamByName('Alpha')).toBe(team);
    });

    test('getTeamByName returns undefined for missing name', () => {
      expect(registry.getTeamByName('Missing')).toBeUndefined();
    });

    test('listTeams returns all teams', () => {
      registry.createTeam({name: 'A', goal: 'G1'});
      registry.createTeam({name: 'B', goal: 'G2'});
      expect(registry.listTeams()).toHaveLength(2);
    });

    test('listTeams filters by status', () => {
      const t1 = registry.createTeam({name: 'A', goal: 'G1'});
      registry.createTeam({name: 'B', goal: 'G2'});
      registry.updateTeamStatus(t1.teamId, 'spawning');

      expect(registry.listTeams({status: 'created'})).toHaveLength(1);
      expect(registry.listTeams({status: 'spawning'})).toHaveLength(1);
    });
  });

  // ── updateTeamStatus ───────────────────────────────────────────────

  describe('updateTeamStatus', () => {
    test('valid transition: created → spawning', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.updateTeamStatus(team.teamId, 'spawning');
      expect(registry.getTeam(team.teamId)!.status).toBe('spawning');
    });

    test('full lifecycle: created → … → archived', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      const transitions: TeamStatus[] = [
        'spawning', 'running', 'completing', 'completed', 'archived',
      ];
      for (const status of transitions) {
        registry.updateTeamStatus(team.teamId, status);
      }
      expect(registry.getTeam(team.teamId)!.status).toBe('archived');
    });

    test('sets completedAt on completed', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'running');
      registry.updateTeamStatus(team.teamId, 'completing');
      registry.updateTeamStatus(team.teamId, 'completed');
      expect(registry.getTeam(team.teamId)!.completedAt).toBeDefined();
    });

    test('invalid transition throws', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      // created → completing is not a valid transition
      expect(() => registry.updateTeamStatus(team.teamId, 'completing')).toThrow(
        /Invalid status transition/,
      );
    });

    test('cannot go from completed to running', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'running');
      registry.updateTeamStatus(team.teamId, 'completing');
      registry.updateTeamStatus(team.teamId, 'completed');
      expect(() => registry.updateTeamStatus(team.teamId, 'running')).toThrow(
        TeamRegistryError,
      );
    });

    test('any active state can transition to failed', () => {
      for (const from of ['spawning', 'running', 'paused', 'completing'] as const) {
        const r = new TeamRegistry();
        const t = r.createTeam({name: `T-${from}`, goal: 'G'});
        // Get to the target state
        if (from === 'spawning') {
          r.updateTeamStatus(t.teamId, 'spawning');
        } else if (from === 'running') {
          r.updateTeamStatus(t.teamId, 'spawning');
          r.updateTeamStatus(t.teamId, 'running');
        } else if (from === 'paused') {
          r.updateTeamStatus(t.teamId, 'spawning');
          r.updateTeamStatus(t.teamId, 'running');
          r.updateTeamStatus(t.teamId, 'paused');
        } else if (from === 'completing') {
          r.updateTeamStatus(t.teamId, 'spawning');
          r.updateTeamStatus(t.teamId, 'running');
          r.updateTeamStatus(t.teamId, 'completing');
        }
        r.updateTeamStatus(t.teamId, 'failed');
        expect(r.getTeam(t.teamId)!.status).toBe('failed');
      }
    });

    test('throws for nonexistent team', () => {
      expect(() => registry.updateTeamStatus('nope', 'running')).toThrow(
        /Team not found/,
      );
    });
  });

  // ── registerMember ─────────────────────────────────────────────────

  describe('registerMember', () => {
    test('adds member to team', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      const member = makeMember({memberId: 'm1', teamId: team.teamId});
      registry.registerMember(team.teamId, member);
      expect(registry.getMembersByTeam(team.teamId)).toHaveLength(1);
    });

    test('enforces maxMembers', () => {
      const team = registry.createTeam({
        name: 'A',
        goal: 'G',
        config: {maxMembers: 2},
      });
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));
      registry.registerMember(team.teamId, makeMember({memberId: 'm2', teamId: team.teamId}));

      expect(() =>
        registry.registerMember(team.teamId, makeMember({memberId: 'm3', teamId: team.teamId})),
      ).toThrow(/maxMembers/);
    });

    test('enforces global maxTotalAgents', () => {
      // Create enough teams to hit the global limit
      const totalMax = SECURITY_DEFAULTS.maxTotalAgents;
      const team = registry.createTeam({name: 'Big', goal: 'G', config: {maxMembers: totalMax + 5}});

      for (let i = 0; i < totalMax; i++) {
        registry.registerMember(
          team.teamId,
          makeMember({memberId: `m${i}`, teamId: team.teamId}),
        );
      }

      expect(() =>
        registry.registerMember(
          team.teamId,
          makeMember({memberId: 'overflow', teamId: team.teamId}),
        ),
      ).toThrow(/maxTotalAgents/);
    });

    test('throws for nonexistent team', () => {
      expect(() =>
        registry.registerMember('nope', makeMember({memberId: 'm1', teamId: 'nope'})),
      ).toThrow(/Team not found/);
    });
  });

  // ── removeMember / updateMember ────────────────────────────────────

  describe('removeMember', () => {
    test('removes member from team', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));
      registry.removeMember(team.teamId, 'm1');
      expect(registry.getMembersByTeam(team.teamId)).toHaveLength(0);
    });

    test('no-op for nonexistent member', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.removeMember(team.teamId, 'nonexistent');
      // Should not throw
    });
  });

  describe('updateMember', () => {
    test('updates member fields', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));
      registry.updateMember(team.teamId, 'm1', {status: 'working'});
      expect(registry.getMember('m1')!.status).toBe('working');
    });
  });

  // ── getMember ──────────────────────────────────────────────────────

  describe('getMember', () => {
    test('finds member across teams', () => {
      const t1 = registry.createTeam({name: 'A', goal: 'G1'});
      const t2 = registry.createTeam({name: 'B', goal: 'G2'});
      registry.registerMember(t1.teamId, makeMember({memberId: 'x1', teamId: t1.teamId}));
      registry.registerMember(t2.teamId, makeMember({memberId: 'x2', teamId: t2.teamId}));

      expect(registry.getMember('x2')?.teamId).toBe(t2.teamId);
    });

    test('returns undefined for missing member', () => {
      expect(registry.getMember('ghost')).toBeUndefined();
    });
  });

  // ── getMembersByTeam / getMembersByRole / getLeader ─────────────────

  describe('member queries', () => {
    test('getMembersByTeam returns team members', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));
      registry.registerMember(team.teamId, makeMember({memberId: 'm2', teamId: team.teamId}));
      expect(registry.getMembersByTeam(team.teamId)).toHaveLength(2);
    });

    test('getMembersByRole filters by role', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'l1', teamId: team.teamId, role: 'leader'}));
      registry.registerMember(team.teamId, makeMember({memberId: 'w1', teamId: team.teamId, role: 'worker'}));
      registry.registerMember(team.teamId, makeMember({memberId: 'w2', teamId: team.teamId, role: 'worker'}));

      expect(registry.getMembersByRole(team.teamId, 'leader')).toHaveLength(1);
      expect(registry.getMembersByRole(team.teamId, 'worker')).toHaveLength(2);
      // 'reviewer' is not a valid role, cast to test zero-result filtering
      expect(registry.getMembersByRole(team.teamId, 'reviewer' as 'leader' | 'worker')).toHaveLength(0);
    });

    test('getLeader returns the leader', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'l1', teamId: team.teamId, role: 'leader'}));
      registry.registerMember(team.teamId, makeMember({memberId: 'w1', teamId: team.teamId, role: 'worker'}));

      const leader = registry.getLeader(team.teamId);
      expect(leader).toBeDefined();
      expect(leader!.memberId).toBe('l1');
    });

    test('getLeader returns undefined when no leader', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      expect(registry.getLeader(team.teamId)).toBeUndefined();
    });
  });

  // ── getTotalAgentCount ─────────────────────────────────────────────

  describe('getTotalAgentCount', () => {
    test('counts across all active teams', () => {
      const t1 = registry.createTeam({name: 'A', goal: 'G1'});
      const t2 = registry.createTeam({name: 'B', goal: 'G2'});
      registry.registerMember(t1.teamId, makeMember({memberId: 'm1', teamId: t1.teamId}));
      registry.registerMember(t1.teamId, makeMember({memberId: 'm2', teamId: t1.teamId}));
      registry.registerMember(t2.teamId, makeMember({memberId: 'm3', teamId: t2.teamId}));

      expect(registry.getTotalAgentCount()).toBe(3);
    });

    test('excludes archived teams', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));

      // Archive the team
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'running');
      registry.updateTeamStatus(team.teamId, 'completing');
      registry.updateTeamStatus(team.teamId, 'completed');
      registry.updateTeamStatus(team.teamId, 'archived');

      expect(registry.getTotalAgentCount()).toBe(0);
    });
  });

  // ── getJobBoard ────────────────────────────────────────────────────

  describe('getJobBoard', () => {
    test('returns job board for existing team', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      const board = registry.getJobBoard(team.teamId);
      expect(board.teamId).toBe(team.teamId);
    });

    test('creates job board if missing', () => {
      // Directly call getJobBoard for an ID that has no board
      const board = registry.getJobBoard('unknown_team');
      expect(board).toBeDefined();
      expect(board.teamId).toBe('unknown_team');
    });

    test('returns same board on repeated calls', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      const b1 = registry.getJobBoard(team.teamId);
      const b2 = registry.getJobBoard(team.teamId);
      expect(b1).toBe(b2);
    });
  });

  // ── createSubTeam ──────────────────────────────────────────────────

  describe('createSubTeam', () => {
    test('sets correct depth, parent, and root', () => {
      const parent = registry.createTeam({name: 'Root', goal: 'G', config: {allowSubTeams: true, maxDepth: 2}});
      const child = registry.createSubTeam(parent.teamId, {
        name: 'Child',
        goal: 'Sub-G',
        createdBy: 'agent_leader',
      });

      expect(child.depth).toBe(1);
      expect(child.parentTeamId).toBe(parent.teamId);
      expect(child.rootTeamId).toBe(parent.teamId);
      expect(child.createdBy).toBe('agent_leader');
      expect(child.status).toBe('created');
    });

    test('inherits config from parent', () => {
      const parent = registry.createTeam({
        name: 'Root',
        goal: 'G',
        config: {maxMembers: 5, allowSubTeams: true, maxDepth: 2},
      });
      const child = registry.createSubTeam(parent.teamId, {
        name: 'Child',
        goal: 'Sub-G',
        createdBy: 'agent',
      });

      expect(child.config.maxMembers).toBe(5);
    });

    test('overrides config with input', () => {
      const parent = registry.createTeam({name: 'Root', goal: 'G', config: {allowSubTeams: true, maxDepth: 2}});
      const child = registry.createSubTeam(parent.teamId, {
        name: 'Child',
        goal: 'Sub-G',
        createdBy: 'agent',
        config: {maxMembers: 3},
      });

      expect(child.config.maxMembers).toBe(3);
    });

    test('validates depth limit', () => {
      const root = registry.createTeam({name: 'Root', goal: 'G', config: {maxDepth: 1, allowSubTeams: true}});
      const child = registry.createSubTeam(root.teamId, {
        name: 'L1',
        goal: 'G',
        createdBy: 'a',
      });

      expect(() =>
        registry.createSubTeam(child.teamId, {
          name: 'L2',
          goal: 'G',
          createdBy: 'a',
        }),
      ).toThrow(/maxDepth/);
    });

    test('validates allowSubTeams', () => {
      const parent = registry.createTeam({
        name: 'Root',
        goal: 'G',
        config: {allowSubTeams: false},
      });

      expect(() =>
        registry.createSubTeam(parent.teamId, {
          name: 'Child',
          goal: 'G',
          createdBy: 'a',
        }),
      ).toThrow(/does not allow sub-teams/);
    });

    test('validates name uniqueness', () => {
      const parent = registry.createTeam({name: 'Root', goal: 'G', config: {allowSubTeams: true, maxDepth: 2}});
      registry.createSubTeam(parent.teamId, {name: 'Child', goal: 'G', createdBy: 'a'});

      expect(() =>
        registry.createSubTeam(parent.teamId, {name: 'Child', goal: 'G2', createdBy: 'a'}),
      ).toThrow(/already exists/);
    });

    test('throws for nonexistent parent', () => {
      expect(() =>
        registry.createSubTeam('nope', {name: 'X', goal: 'G', createdBy: 'a'}),
      ).toThrow(/Team not found/);
    });

    test('preserves rootTeamId through multiple levels', () => {
      const root = registry.createTeam({name: 'Root', goal: 'G', config: {allowSubTeams: true, maxDepth: 3}});
      const l1 = registry.createSubTeam(root.teamId, {name: 'L1', goal: 'G', createdBy: 'a'});
      const l2 = registry.createSubTeam(l1.teamId, {name: 'L2', goal: 'G', createdBy: 'a'});

      expect(l2.rootTeamId).toBe(root.teamId);
      expect(l2.depth).toBe(2);
    });
  });

  // ── deleteTeam ─────────────────────────────────────────────────────

  describe('deleteTeam', () => {
    test('removes team, members, and jobboard', () => {
      const team = registry.createTeam({name: 'A', goal: 'G'});
      registry.registerMember(team.teamId, makeMember({memberId: 'm1', teamId: team.teamId}));

      // Use the job board
      registry.getJobBoard(team.teamId).planJobs([{title: 'J1', description: 'D'}]);

      registry.deleteTeam(team.teamId);

      expect(registry.getTeam(team.teamId)).toBeUndefined();
      expect(registry.getMembersByTeam(team.teamId)).toHaveLength(0);
      // A new board is created if we call getJobBoard — verify it's empty
      const board = registry.getJobBoard(team.teamId);
      expect(board.getAllJobs()).toHaveLength(0);
    });

    test('no-op for nonexistent team', () => {
      registry.deleteTeam('nonexistent');
      // Should not throw
    });
  });
});

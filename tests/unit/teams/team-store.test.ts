import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'bun:test';

import {JobBoard} from '@capability/team/job-board';
import {JobBoardStore} from '@capability/team/persistence/job-board-store';
import {MemberStore} from '@capability/team/persistence/member-store';
import {TeamStore} from '@capability/team/persistence/team-store';
import type {Team, TeamMember} from '@capability/team/types';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'teamstore-'));
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    teamId: 'team-1',
    name: 'Test Team',
    rootTeamId: 'team-1',
    status: 'running',
    goal: 'Build something',
    createdBy: 'user-1',
    depth: 0,
    config: {
      maxDepth: 2,
      allowSubTeams: true,
      maxMembers: 10,
      modelCascade: {default: 'claude-sonnet-4-6'},
      worktreeStrategy: 'per-agent',
      autoShutdown: true,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    memberId: 'member-1',
    name: 'Worker A',
    teamId: 'team-1',
    role: 'worker',
    status: 'idle',
    sessionId: 'sess-1',
    mode: 'local',
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── TeamStore ─────────────────────────────────────────────────────────────

describe('TeamStore', () => {
  test('save/load round-trip', () => {
    const store = new TeamStore(makeTmpDir());
    const team = makeTeam();
    store.save(team);
    const loaded = store.load('team-1');
    expect(loaded).toBeDefined();
    expect(loaded!.teamId).toBe('team-1');
    expect(loaded!.name).toBe('Test Team');
    expect(loaded!.goal).toBe('Build something');
  });

  test('load non-existent returns undefined', () => {
    const store = new TeamStore(makeTmpDir());
    expect(store.load('nope')).toBeUndefined();
  });

  test('saveRegistry/loadRegistry round-trip', () => {
    const store = new TeamStore(makeTmpDir());
    const teams = [makeTeam(), makeTeam({teamId: 'team-2', name: 'Second'})];
    store.saveRegistry(teams);
    const registry = store.loadRegistry();
    expect(registry).toHaveLength(2);
    expect(registry[0].teamId).toBe('team-1');
    expect(registry[1].teamId).toBe('team-2');
  });

  test('delete removes team data', () => {
    const store = new TeamStore(makeTmpDir());
    const team = makeTeam();
    store.save(team);
    expect(store.load('team-1')).toBeDefined();
    store.delete('team-1');
    expect(store.load('team-1')).toBeUndefined();
  });
});

// ── JobBoardStore ─────────────────────────────────────────────────────────

describe('JobBoardStore', () => {
  test('save/load round-trip with jobs', () => {
    const store = new JobBoardStore(makeTmpDir());
    const board = new JobBoard('team-1');
    board.planJobs([
      {title: 'Task A', description: 'Do A'},
      {title: 'Task B', description: 'Do B'},
    ]);
    store.save(board);
    const loaded = store.load('team-1');
    expect(loaded).toBeDefined();
    expect(loaded!.getAllJobs()).toHaveLength(2);
    expect(loaded!.teamId).toBe('team-1');
  });

  test('load non-existent returns undefined', () => {
    const store = new JobBoardStore(makeTmpDir());
    expect(store.load('nope')).toBeUndefined();
  });
});

// ── MemberStore ───────────────────────────────────────────────────────────

describe('MemberStore', () => {
  test('save/load round-trip', () => {
    const store = new MemberStore(makeTmpDir());
    const member = makeMember();
    store.save(member);
    const loaded = store.load('team-1', 'member-1');
    expect(loaded).toBeDefined();
    expect(loaded!.memberId).toBe('member-1');
    expect(loaded!.name).toBe('Worker A');
  });

  test('loadByTeam returns all members', () => {
    const store = new MemberStore(makeTmpDir());
    store.save(makeMember({memberId: 'member-1', name: 'A'}));
    store.save(makeMember({memberId: 'member-2', name: 'B'}));
    store.save(makeMember({memberId: 'member-3', name: 'C'}));
    const members = store.loadByTeam('team-1');
    expect(members).toHaveLength(3);
    const names = members.map((m) => m.name).sort();
    expect(names).toEqual(['A', 'B', 'C']);
  });

  test('delete removes member file', () => {
    const store = new MemberStore(makeTmpDir());
    store.save(makeMember());
    expect(store.load('team-1', 'member-1')).toBeDefined();
    store.delete('team-1', 'member-1');
    expect(store.load('team-1', 'member-1')).toBeUndefined();
  });
});

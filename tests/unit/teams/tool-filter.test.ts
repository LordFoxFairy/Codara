import {describe, test, expect, beforeEach} from 'bun:test';
import {z} from 'zod';
import {TeamRegistry} from '@capability/team/team-registry';
import {LocalTransport} from '@capability/team/transport/local-transport';
import {TeamEventEmitter} from '@capability/team/events';
import {getToolsForRole, isTeamTool} from '@capability/team/tools/tool-filter';
import {createWorkerTools} from '@capability/team/tools/worker-tools';
import {createReviewerTools} from '@capability/team/tools/reviewer-tools';
import type {TeamToolContext} from '@capability/team/tools/types';
import type {TeamMember} from '@capability/team/types';

// ─── Mock base tools ────────────────────────────────────────────────

const mockBaseTool = (name: string) =>
  ({name, description: name, schema: z.object({}), invoke: async () => ''}) as any;

const baseTools = [
  mockBaseTool('read_file'),
  mockBaseTool('bash'),
  mockBaseTool('edit_file'),
  mockBaseTool('write_file'),
  mockBaseTool('Task'),
  mockBaseTool('glob'),
  mockBaseTool('grep'),
];

// ─── Helpers ────────────────────────────────────────────────────────

function makeMember(overrides: Partial<TeamMember> & {memberId: string; teamId: string; role: TeamMember['role']}): TeamMember {
  return {
    name: overrides.memberId,
    status: 'idle',
    sessionId: `sess_${overrides.memberId}`,
    mode: 'local',
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Tool Filter', () => {
  let ctx: TeamToolContext;

  beforeEach(() => {
    const registry = new TeamRegistry();
    const transport = new LocalTransport();
    const emitter = new TeamEventEmitter();

    const team = registry.createTeam({name: 'test', goal: 'test goal'});
    registry.registerMember(team.teamId, makeMember({memberId: 'leader-1', teamId: team.teamId, role: 'leader'}));
    registry.registerMember(team.teamId, makeMember({memberId: 'worker-1', teamId: team.teamId, role: 'worker'}));

    transport.registerMember('leader-1');
    transport.registerMember('worker-1');

    ctx = {
      teamId: team.teamId,
      memberId: 'worker-1',
      registry,
      transport,
      emitter,
      projectRoot: '/tmp/test',
    };
  });

  // ── getToolsForRole ─────────────────────────────────────────────

  test('worker role includes base tools minus Task, plus 4 worker tools', () => {
    const tools = getToolsForRole('worker', ctx, baseTools);
    const names = tools.map((t) => t.name);

    // No Task tool
    expect(names).not.toContain('Task');

    // Has base tools except Task
    expect(names).toContain('read_file');
    expect(names).toContain('bash');
    expect(names).toContain('edit_file');

    // Has worker team tools
    expect(names).toContain('team_claim_job');
    expect(names).toContain('team_submit_job');
    expect(names).toContain('team_send_message');
    expect(names).toContain('team_ask_leader');

    // 6 base (7 minus Task) + 4 worker = 10
    expect(tools).toHaveLength(10);
  });

  test('reviewer role includes only read-only base tools + 2 reviewer tools', () => {
    const tools = getToolsForRole('reviewer', ctx, baseTools);
    const names = tools.map((t) => t.name);

    // Only read-only tools from base
    expect(names).toContain('read_file');
    expect(names).toContain('bash');
    expect(names).toContain('glob');
    expect(names).toContain('grep');

    // No write tools
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('Task');

    // Has reviewer team tools
    expect(names).toContain('team_review_submit');
    expect(names).toContain('team_send_message');

    // 4 read-only base + 2 reviewer = 6
    expect(tools).toHaveLength(6);
  });

  test('leader role returns only team coordination tools', () => {
    // Note: this test depends on leader-tools being implemented.
    // Since leader-tools is built in parallel, we just verify it returns tools
    // and all are team_ prefixed.
    const tools = getToolsForRole('leader', ctx);
    expect(tools.length).toBeGreaterThan(0);

    for (const t of tools) {
      expect(t.name).toStartWith('team_');
    }
  });

  // ── isTeamTool ──────────────────────────────────────────────────

  test('isTeamTool identifies team tools correctly', () => {
    const workerTools = createWorkerTools(ctx);
    for (const t of workerTools) {
      expect(isTeamTool(t)).toBe(true);
    }

    const reviewerTools = createReviewerTools(ctx);
    for (const t of reviewerTools) {
      expect(isTeamTool(t)).toBe(true);
    }
  });

  test('isTeamTool returns false for non-team tools', () => {
    expect(isTeamTool(mockBaseTool('read_file'))).toBe(false);
    expect(isTeamTool(mockBaseTool('bash'))).toBe(false);
    expect(isTeamTool(mockBaseTool('Task'))).toBe(false);
  });

  // ── Worker tools don't include Task ─────────────────────────────

  test('worker tools exclude Task from base tools', () => {
    const tools = getToolsForRole('worker', ctx, baseTools);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('Task');
  });
});

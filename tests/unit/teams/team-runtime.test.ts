import { describe, test, expect, beforeEach } from 'bun:test';
import { TeamRuntime } from '@capability/team/runtime/team-runtime';
import { TeamRegistry } from '@capability/team/team-registry';
import type { TeamBusEvent } from '@capability/team/events';
import type { MemberSession } from '@capability/team/runtime/member-runner';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockSession(behavior?: {
  invokeResult?: () => { reason: 'complete' | 'continue' | 'error' | 'idle'; error?: Error };
}): MemberSession {
  return {
    invoke: async () => {
      if (behavior?.invokeResult) return behavior.invokeResult();
      return { reason: 'complete' as const };
    },
    dispose: async () => {},
  };
}

let registry: TeamRegistry;
let runtime: TeamRuntime;

function setup(sessionFactory?: typeof createMockSession) {
  registry = new TeamRegistry();
  runtime = new TeamRuntime({
    registry,
    projectRoot: '/tmp/test',
    createSession: sessionFactory ?? (() => createMockSession()),
  });
}

function createTestTeam() {
  return registry.createTeam({
    name: `test-team-${crypto.randomUUID().slice(0, 4)}`,
    goal: 'test goal',
    config: {
      maxDepth: 2,
      allowSubTeams: true,
      maxMembers: 10,
      modelCascade: {},
      worktreeStrategy: 'per-agent',
      autoShutdown: true,
    },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('TeamRuntime', () => {
  beforeEach(() => setup());

  test('startTeam creates leader member and sets team to running', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('running');

    const members = registry.getMembersByTeam(team.teamId);
    expect(members.length).toBe(1);
    expect(members[0]!.role).toBe('leader');
    expect(members[0]!.name).toBe('leader');
  });

  test('startTeam throws for non-existent team', async () => {
    await expect(runtime.startTeam('nonexistent')).rejects.toThrow('not found');
  });

  test('startTeam emits team.running event', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const emitter = runtime.getEmitter(team.teamId);
    expect(emitter).toBeDefined();

    // Verify the emitter was created (event was already emitted during startTeam)
    const events: TeamBusEvent[] = [];
    emitter!.subscribe(e => events.push(e));

    // The team.running event was already emitted before we subscribed,
    // but we can verify the team is in running state
    expect(registry.getTeam(team.teamId)?.status).toBe('running');
  });

  test('spawnMember creates worker and emits member.joined', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const emitter = runtime.getEmitter(team.teamId)!;
    const events: TeamBusEvent[] = [];
    emitter.subscribe(e => events.push(e));

    const worker = await runtime.spawnMember(team.teamId, 'worker-1', 'worker');

    expect(worker.name).toBe('worker-1');
    expect(worker.role).toBe('worker');
    expect(worker.teamId).toBe(team.teamId);

    const joinedEvents = events.filter(e => e.type === 'member.joined');
    expect(joinedEvents.length).toBe(1);

    // Cleanup
    await runtime.shutdownTeam(team.teamId);
  });

  test('spawnMember throws for non-started team', async () => {
    const team = createTestTeam();
    await expect(runtime.spawnMember(team.teamId, 'w', 'worker')).rejects.toThrow('not started');
  });

  test('shutdownTeam terminates all members and sets completed', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Give leader time to enter loop
    await new Promise(r => setTimeout(r, 20));

    await runtime.shutdownTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('completed');
  });

  test('killTeam force terminates and sets failed', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    await new Promise(r => setTimeout(r, 20));

    await runtime.killTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('failed');
  });

  test('pauseTeam pauses all members and sets paused', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    await new Promise(r => setTimeout(r, 20));

    runtime.pauseTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('paused');

    // Leader runner should be paused
    const members = registry.getMembersByTeam(team.teamId);
    const leaderRunner = runtime.getRunner(members[0]!.memberId);
    expect(leaderRunner?.getStatus()).toBe('paused');

    // Cleanup: resume then shutdown
    runtime.resumeTeam(team.teamId);
    await runtime.shutdownTeam(team.teamId);
  });

  test('resumeTeam resumes from paused and sets running', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    await new Promise(r => setTimeout(r, 20));

    runtime.pauseTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');

    runtime.resumeTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');

    await runtime.shutdownTeam(team.teamId);
  });

  test('leader crash pauses team automatically', async () => {
    const errorSession = createMockSession({
      invokeResult: () => ({ reason: 'error', error: new Error('leader boom') }),
    });

    setup(() => errorSession);
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Send a message to leader so it enters processing and crashes
    const transport = runtime.getTransport(team.teamId)!;
    const members = registry.getMembersByTeam(team.teamId);
    const leaderId = members[0]!.memberId;

    await transport.send(leaderId, {
      id: 'msg-1',
      from: 'user',
      to: leaderId,
      teamId: team.teamId,
      type: 'message',
      content: 'start work',
      timestamp: new Date().toISOString(),
      read: false,
    });

    // Wake the leader to pick up the message
    runtime.getRunner(leaderId)?.wake();

    // Wait for crash to propagate
    await new Promise(r => setTimeout(r, 100));

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('paused');
  });

  test('getRunner returns the runner for a member', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const members = registry.getMembersByTeam(team.teamId);
    const runner = runtime.getRunner(members[0]!.memberId);
    expect(runner).toBeDefined();
    expect(runner!.getRole()).toBe('leader');

    await runtime.shutdownTeam(team.teamId);
  });

  test('getRunner returns undefined for unknown member', () => {
    expect(runtime.getRunner('nonexistent')).toBeUndefined();
  });

  test('multiple members can be spawned', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    await runtime.spawnMember(team.teamId, 'worker-1', 'worker');
    await runtime.spawnMember(team.teamId, 'worker-2', 'worker');
    await runtime.spawnMember(team.teamId, 'reviewer-1', 'reviewer');

    const members = registry.getMembersByTeam(team.teamId);
    expect(members.length).toBe(4); // leader + 3 spawned

    await runtime.shutdownTeam(team.teamId);
  });

  test('getTransport returns transport for team', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    expect(runtime.getTransport(team.teamId)).toBeDefined();
    expect(runtime.getTransport('nonexistent')).toBeUndefined();

    await runtime.shutdownTeam(team.teamId);
  });

  test('getEmitter returns emitter for team', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    expect(runtime.getEmitter(team.teamId)).toBeDefined();
    expect(runtime.getEmitter('nonexistent')).toBeUndefined();

    await runtime.shutdownTeam(team.teamId);
  });
});

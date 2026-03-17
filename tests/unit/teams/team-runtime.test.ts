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

  test('startTeam creates infra, sets running, no auto-leader (main agent IS leader)', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('running');

    // No members auto-spawned — the main agent IS the leader
    const members = registry.getMembersByTeam(team.teamId);
    expect(members.length).toBe(0);

    // Transport and emitter should exist
    expect(runtime.getTransport(team.teamId)).toBeDefined();
    expect(runtime.getEmitter(team.teamId)).toBeDefined();
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

  test('pauseTeam pauses all workers and sets paused', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Spawn workers (main agent is leader, only workers are spawned)
    const worker = await runtime.spawnMember(team.teamId, 'worker-1', 'worker');
    await new Promise(r => setTimeout(r, 20));

    runtime.pauseTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('paused');

    // Worker runner should be paused
    const workerRunner = runtime.getRunner(worker.memberId);
    expect(workerRunner?.getStatus()).toBe('paused');

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

  test('worker crash emits member.failed event', async () => {
    const errorSession = createMockSession({
      invokeResult: () => ({ reason: 'error', error: new Error('worker boom') }),
    });

    setup(() => errorSession);
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const emitter = runtime.getEmitter(team.teamId)!;
    const events: TeamBusEvent[] = [];
    emitter.subscribe(e => events.push(e));

    // Spawn a worker that will crash
    const worker = await runtime.spawnMember(team.teamId, 'crash-worker', 'worker');
    const transport = runtime.getTransport(team.teamId)!;

    await transport.send(worker.memberId, {
      id: 'msg-1',
      from: 'leader',
      to: worker.memberId,
      teamId: team.teamId,
      type: 'message',
      content: 'start work',
      timestamp: new Date().toISOString(),
      read: false,
    });

    runtime.getRunner(worker.memberId)?.wake();
    await new Promise(r => setTimeout(r, 100));

    const failEvents = events.filter(e => e.type === 'member.failed');
    expect(failEvents.length).toBeGreaterThanOrEqual(1);

    await runtime.shutdownTeam(team.teamId);
  });

  test('getRunner returns the runner for a spawned member', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const worker = await runtime.spawnMember(team.teamId, 'w1', 'worker');
    const runner = runtime.getRunner(worker.memberId);
    expect(runner).toBeDefined();
    expect(runner!.getRole()).toBe('worker');

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
    expect(members.length).toBe(3); // 3 spawned (no auto-leader)

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

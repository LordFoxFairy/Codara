import { describe, test, expect, beforeEach } from 'bun:test';
import { MemberRunner } from '@capability/team/runtime/member-runner';
import type { MemberRunnerOptions, MemberSession } from '@capability/team/runtime/member-runner';
import { TeamRegistry } from '@capability/team/team-registry';
import { LocalTransport } from '@capability/team/transport/local-transport';
import { TeamEventEmitter } from '@capability/team/events';
import type { TeamMember, TeamBusEvent } from '@capability/team/types';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockSession(behavior?: {
  invokeResult?: () => { reason: 'complete' | 'continue' | 'error' | 'idle'; error?: Error };
}): MemberSession & { invokeCount: number; disposed: boolean } {
  const session = {
    invokeCount: 0,
    disposed: false,
    invoke: async () => {
      session.invokeCount++;
      if (behavior?.invokeResult) return behavior.invokeResult();
      return { reason: 'complete' as const };
    },
    dispose: async () => {
      session.disposed = true;
    },
  };
  return session;
}

function buildTestMember(teamId: string, overrides?: Partial<TeamMember>): TeamMember {
  return {
    memberId: 'member-1',
    name: 'test-worker',
    teamId,
    role: 'worker',
    status: 'initializing',
    mode: 'local',
    sessionId: `session-${teamId}-test`,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildOptions(overrides?: Partial<MemberRunnerOptions>): MemberRunnerOptions {
  const registry = new TeamRegistry();
  const team = registry.createTeam({
    name: 'test-team',
    goal: 'test goal',
    config: { maxDepth: 2, allowSubTeams: true, maxMembers: 10, modelCascade: {}, worktreeStrategy: 'per-agent', autoShutdown: true },
  });
  const transport = new LocalTransport();
  const emitter = new TeamEventEmitter();
  const member = buildTestMember(team.teamId);

  registry.registerMember(team.teamId, member);
  transport.registerMember(member.memberId);

  return {
    member,
    teamName: team.name,
    goal: team.goal,
    depth: 0,
    maxDepth: 2,
    registry,
    transport,
    emitter,
    projectRoot: '/tmp/test',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('MemberRunner', () => {
  test('initial status is created', () => {
    const runner = new MemberRunner(buildOptions());
    expect(runner.getStatus()).toBe('created');
    expect(runner.isShutdownRequested()).toBe(false);
  });

  test('getters return member info', () => {
    const opts = buildOptions();
    const runner = new MemberRunner(opts);
    expect(runner.getMemberId()).toBe(opts.member.memberId);
    expect(runner.getMemberName()).toBe(opts.member.name);
    expect(runner.getRole()).toBe(opts.member.role);
  });

  test('start() updates member status to idle and emits event', async () => {
    const opts = buildOptions();
    const events: TeamBusEvent[] = [];
    opts.emitter.subscribe(e => events.push(e));

    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    // Give it a tick to enter the loop and go idle
    await new Promise(r => setTimeout(r, 10));

    runner.requestShutdown();
    await startPromise;

    // Should have emitted member.idle at least once
    const idleEvents = events.filter(e => e.type === 'member.idle');
    expect(idleEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('start() throws if already started', async () => {
    const opts = buildOptions();
    const runner = new MemberRunner(opts);

    const startPromise = runner.start();
    await new Promise(r => setTimeout(r, 10));

    // Second start should reject (async)
    await expect(runner.start()).rejects.toThrow('Cannot start');

    runner.requestShutdown();
    await startPromise;
  });

  test('requestShutdown() stops the run loop', async () => {
    const runner = new MemberRunner(buildOptions());
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));
    runner.requestShutdown();
    await startPromise;

    expect(runner.getStatus()).toBe('terminated');
    expect(runner.isShutdownRequested()).toBe(true);
  });

  test('wake() unblocks idle member', async () => {
    const opts = buildOptions();
    const events: TeamBusEvent[] = [];
    opts.emitter.subscribe(e => events.push(e));

    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    // Wait for idle state
    await new Promise(r => setTimeout(r, 10));
    expect(runner.getStatus()).toBe('idle');

    // Wake it, but it will go idle again since no messages
    runner.wake();
    await new Promise(r => setTimeout(r, 10));

    // Should still be idle (no messages to process)
    expect(runner.getStatus()).toBe('idle');

    runner.requestShutdown();
    await startPromise;
  });

  test('pause() sets paused status and emits event', async () => {
    const opts = buildOptions();
    const events: TeamBusEvent[] = [];
    opts.emitter.subscribe(e => events.push(e));

    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));

    runner.pause();
    expect(runner.getStatus()).toBe('paused');

    const pauseEvents = events.filter(e => e.type === 'member.paused');
    expect(pauseEvents.length).toBe(1);

    runner.requestShutdown();
    // resume so the loop can exit
    runner.resume();
    await startPromise;
  });

  test('resume() returns to idle from paused', async () => {
    const opts = buildOptions();
    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));
    runner.pause();
    expect(runner.getStatus()).toBe('paused');

    runner.resume();
    await new Promise(r => setTimeout(r, 10));
    expect(runner.getStatus()).toBe('idle');

    runner.requestShutdown();
    await startPromise;
  });

  test('error in session terminates member and emits event', async () => {
    const opts = buildOptions();
    const mockSession = createMockSession({
      invokeResult: () => ({ reason: 'error', error: new Error('session boom') }),
    });
    opts.createSession = () => mockSession;

    const events: TeamBusEvent[] = [];
    opts.emitter.subscribe(e => events.push(e));

    // Send a message so the runner enters the processing path
    await opts.transport.send(opts.member.memberId, {
      id: 'msg-1',
      from: 'leader',
      to: opts.member.memberId,
      teamId: opts.member.teamId,
      type: 'message',
      content: 'do work',
      timestamp: new Date().toISOString(),
      read: false,
    });

    const runner = new MemberRunner(opts);

    await expect(runner.start()).rejects.toThrow('session boom');
    expect(runner.getStatus()).toBe('terminated');

    const failEvents = events.filter(e => e.type === 'member.failed');
    expect(failEvents.length).toBe(1);
  });

  test('shutdown request wakes idle member and terminates', async () => {
    const runner = new MemberRunner(buildOptions());
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));
    expect(runner.getStatus()).toBe('idle');

    runner.requestShutdown();
    await startPromise;

    expect(runner.getStatus()).toBe('terminated');
  });

  test('session dispose is called on shutdown', async () => {
    const opts = buildOptions();
    const mockSession = createMockSession();
    opts.createSession = () => mockSession;

    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));
    runner.requestShutdown();
    await startPromise;

    expect(mockSession.disposed).toBe(true);
  });

  test('member.left event is emitted on graceful shutdown', async () => {
    const opts = buildOptions();
    const events: TeamBusEvent[] = [];
    opts.emitter.subscribe(e => events.push(e));

    const runner = new MemberRunner(opts);
    const startPromise = runner.start();

    await new Promise(r => setTimeout(r, 10));
    runner.requestShutdown();
    await startPromise;

    const leftEvents = events.filter(e => e.type === 'member.left');
    expect(leftEvents.length).toBe(1);
  });
});

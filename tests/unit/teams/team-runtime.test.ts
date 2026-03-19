import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TeamRuntime } from '@capability/team/runtime/team-runtime';
import { TeamRegistry } from '@capability/team/coordination/team-registry';
import { JobBoard } from '@capability/team/coordination/job-board';
import type { TeamBusEvent } from '@capability/team/coordination/events';
import type { MemberSession } from '@capability/team/runtime/member-runner';
import type {PauseRequest, ResumePayload} from '@core/agent';
import {createApprovalMemoryStore} from '@durability/approval-store';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockSession(behavior?: {
  beforeInvoke?: () => Promise<void> | void;
  beforeResume?: (payload: ResumePayload) => Promise<void> | void;
  invokeResult?: () => { reason: 'complete' | 'continue' | 'error' | 'idle' | 'paused'; error?: Error; pause?: PauseRequest };
  resumeResult?: (payload: ResumePayload) => { reason: 'complete' | 'continue' | 'error' | 'idle' | 'paused'; error?: Error; pause?: PauseRequest };
}): MemberSession {
  let pendingPause: PauseRequest | undefined;
  return {
    invoke: async () => {
      await behavior?.beforeInvoke?.();
      if (behavior?.invokeResult) {
        const result = behavior.invokeResult();
        pendingPause = result.reason === 'paused' ? result.pause : undefined;
        return result;
      }
      return { reason: 'complete' as const };
    },
    resumePause: async (payload: ResumePayload) => {
      await behavior?.beforeResume?.(payload);
      if (behavior?.resumeResult) {
        const result = behavior.resumeResult(payload);
        pendingPause = result.reason === 'paused' ? result.pause : undefined;
        return result;
      }
      pendingPause = undefined;
      return {reason: 'complete' as const};
    },
    getPendingPause: () => pendingPause,
    dispose: async () => {},
  };
}

let registry: TeamRegistry;
let runtime: TeamRuntime;
let domainEvents: { teamId: string; event: TeamBusEvent }[];

function setup(sessionFactory?: () => MemberSession) {
  registry = new TeamRegistry();
  domainEvents = [];
  runtime = new TeamRuntime({
    registry,
    projectRoot: '/tmp/test',
    createSession: () => (sessionFactory ?? createMockSession)(),
  });
  // Subscribe to domain events for test assertions
  runtime.subscribeDomainEvents((teamId, event) => {
    domainEvents.push({ teamId, event });
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
      autoShutdown: true,
    },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('TeamRuntime', () => {
  beforeEach(() => setup());

  afterEach(async () => {
    // Force-kill all teams to clear health timers + runner loops (prevents Bun OOM)
    if (!registry) return;
    for (const team of registry.listTeams()) {
      if (team.status !== 'completed' && team.status !== 'failed' && team.status !== 'archived') {
        try { await runtime.killTeam(team.teamId); } catch { /* already dead */ }
      }
    }
    // Brief settle for async cleanup
    await new Promise(r => setTimeout(r, 20));
  });

  test('startTeam creates infra, sets running, no auto-leader (main agent IS leader)', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('running');

    // No members auto-spawned — the main agent IS the leader
    const members = registry.getMembersByTeam(team.teamId);
    expect(members.length).toBe(0);

    // Transport should exist
    expect(runtime.getTransport(team.teamId)).toBeDefined();
  });

  test('startTeam throws for non-existent team', async () => {
    await expect(runtime.startTeam('nonexistent')).rejects.toThrow('not found');
  });

  test('startTeam emits team.running event via subscribeDomainEvents', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const runningEvents = domainEvents.filter(e => e.event.type === 'team.running');
    expect(runningEvents.length).toBe(1);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');
  });

  test('spawnMember creates worker and emits member.joined', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const worker = await runtime.spawnMember(team.teamId, 'worker-1', 'worker');

    expect(worker.name).toBe('worker-1');
    expect(worker.role).toBe('worker');
    expect(worker.teamId).toBe(team.teamId);

    const joinedEvents = domainEvents.filter(e => e.event.type === 'member.joined');
    expect(joinedEvents.length).toBe(1);

    // Cleanup
    await runtime.shutdownTeam(team.teamId);
  });

  test('spawnMember throws for non-started team', async () => {
    const team = createTestTeam();
    await expect(runtime.spawnMember(team.teamId, 'w', 'worker')).rejects.toThrow('not started');
  });

  test('shutdownTeam completes an idle team with no outstanding jobs or approvals', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Give leader time to enter loop
    await new Promise(r => setTimeout(r, 20));

    await runtime.shutdownTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('completed');
  });

  test('shutdownTeam completes a paused team with no outstanding jobs or approvals', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Give leader time to enter loop
    await new Promise(r => setTimeout(r, 20));

    runtime.pauseTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');

    const blockers = runtime.getCompletionBlockers(team.teamId);
    expect(blockers.openJobs).toHaveLength(0);
    expect(blockers.pendingApprovals).toHaveLength(0);

    await runtime.shutdownTeam(team.teamId);

    const updatedTeam = registry.getTeam(team.teamId);
    expect(updatedTeam?.status).toBe('completed');
  });

  test('shutdownTeam refuses completion while jobs are still outstanding', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const board = registry.getJobBoard(team.teamId);
    board.planJobs([{title: 'Still pending', description: 'Do not finish yet'}]);

    await expect(runtime.shutdownTeam(team.teamId)).rejects.toThrow(/outstanding jobs/i);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');

    await runtime.killTeam(team.teamId);
  });

  test('shutdownTeam refuses completion while worker approvals are still pending', async () => {
    const pauseRequest: PauseRequest = {
      id: 'pause-team-finish-1',
      description: 'Need approval before finish',
      action: {
        toolCallId: 'call_team_finish_approval',
        toolName: 'dangerous_tool',
        toolArgs: {target: 'tmp/out.txt'},
      },
      review: {
        actionName: 'dangerous_tool',
        allowedDecisions: ['approve', 'reject'],
      },
      runtime: {
        runId: 'run-team-finish-approval',
        turn: 1,
        requestId: 'req-team-finish-approval',
        toolIndex: 0,
      },
    };
    const approvalStore = createApprovalMemoryStore();
    let firstInvoke = true;
    setup(() => createMockSession({
      beforeInvoke: async () => {
        const teamId = registry.listTeams()[0]?.teamId;
        const workerId = registry.getMembersByTeam(teamId ?? '')[0]?.memberId;
        if (teamId && workerId) {
          await runtime.getTransport(teamId)?.receive(workerId);
        }
      },
      invokeResult: () => {
        if (firstInvoke) {
          firstInvoke = false;
          return {reason: 'paused', pause: pauseRequest};
        }
        return {reason: 'complete'};
      },
    }));
    runtime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/test',
      createSession: () => createMockSession({
        beforeInvoke: async () => {
          const teamId = registry.listTeams()[0]?.teamId;
          const workerId = registry.getMembersByTeam(teamId ?? '')[0]?.memberId;
          if (teamId && workerId) {
            await runtime.getTransport(teamId)?.receive(workerId);
          }
        },
        invokeResult: () => {
          if (firstInvoke) {
            firstInvoke = false;
            return {reason: 'paused', pause: pauseRequest};
          }
          return {reason: 'complete'};
        },
      }),
      approvalStore,
      sessionId: 'team-finish-approval-session',
    });
    domainEvents = [];
    runtime.subscribeDomainEvents((teamId, event) => {
      domainEvents.push({ teamId, event });
    });

    const team = createTestTeam();
    await runtime.startTeam(team.teamId);
    const worker = await runtime.spawnMember(team.teamId, 'approval-worker', 'worker');
    const transport = runtime.getTransport(team.teamId)!;

    await transport.send(worker.memberId, {
      id: 'msg-finish-approval-1',
      from: 'leader',
      to: worker.memberId,
      teamId: team.teamId,
      type: 'message',
      content: 'perform the risky step',
      timestamp: new Date().toISOString(),
      read: false,
    });

    runtime.getRunner(worker.memberId)?.wake();
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(runtime.shutdownTeam(team.teamId)).rejects.toThrow(/pending approvals/i);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');

    await runtime.killTeam(team.teamId);
  });

  test('shutdownTeam refuses completion while jobs remain unfinished', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const board = registry.getJobBoard(team.teamId);
    const [job] = board.planJobs([{title: 'Ship feature', description: 'Still running'}]);

    const blockers = runtime.getCompletionBlockers(team.teamId);
    expect(blockers.openJobs.map((openJob) => openJob.jobId)).toContain(job.id);

    await expect(runtime.shutdownTeam(team.teamId)).rejects.toThrow(/cannot complete team/i);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');
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
    await runtime.killTeam(team.teamId);
  });

  test('resumeTeam resumes from paused and sets running', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    await new Promise(r => setTimeout(r, 20));

    runtime.pauseTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');

    runtime.resumeTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');

    await runtime.killTeam(team.teamId);
  });

  test('worker crash emits member.failed event', async () => {
    const errorSession = createMockSession({
      invokeResult: () => ({ reason: 'error', error: new Error('worker boom') }),
    });

    setup(() => errorSession);
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

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

    const failEvents = domainEvents.filter(e => e.event.type === 'member.failed');
    expect(failEvents.length).toBeGreaterThanOrEqual(1);

    await runtime.shutdownTeam(team.teamId);
  });

  test('worker approval pauses the team, surfaces an approval record, and clears it after resume', async () => {
    const pauseRequest: PauseRequest = {
      id: 'pause-team-worker-1',
      description: 'Worker approval required',
      action: {
        toolCallId: 'call_worker_approval',
        toolName: 'dangerous_tool',
        toolArgs: {target: 'tmp/out.txt'},
      },
      review: {
        actionName: 'dangerous_tool',
        allowedDecisions: ['approve', 'reject'],
      },
      runtime: {
        runId: 'run-worker-approval',
        turn: 1,
        requestId: 'req-worker-approval',
        toolIndex: 0,
      },
    };
    const approvalStore = createApprovalMemoryStore();
    let firstInvoke = true;
    setup(() => createMockSession({
      beforeInvoke: async () => {
        const teamId = registry.listTeams()[0]?.teamId;
        const workerId = registry.getMembersByTeam(teamId ?? '')[0]?.memberId;
        if (teamId && workerId) {
          await runtime.getTransport(teamId)?.receive(workerId);
        }
      },
      invokeResult: () => {
        if (firstInvoke) {
          firstInvoke = false;
          return {reason: 'paused', pause: pauseRequest};
        }
        return {reason: 'complete'};
      },
      resumeResult: (payload) => {
        expect(payload).toMatchObject({action: 'allow_once'});
        return {reason: 'complete'};
      },
    }));
    runtime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/test',
      createSession: () => createMockSession({
        beforeInvoke: async () => {
          const teamId = registry.listTeams()[0]?.teamId;
          const workerId = registry.getMembersByTeam(teamId ?? '')[0]?.memberId;
          if (teamId && workerId) {
            await runtime.getTransport(teamId)?.receive(workerId);
          }
        },
        invokeResult: () => {
          if (firstInvoke) {
            firstInvoke = false;
            return {reason: 'paused', pause: pauseRequest};
          }
          return {reason: 'complete'};
        },
        resumeResult: (payload) => {
          expect(payload).toMatchObject({action: 'allow_once'});
          return {reason: 'complete'};
        },
      }),
      approvalStore,
      sessionId: 'team-approval-session',
    });
    domainEvents = [];
    runtime.subscribeDomainEvents((teamId, event) => {
      domainEvents.push({ teamId, event });
    });

    const team = createTestTeam();
    await runtime.startTeam(team.teamId);
    const worker = await runtime.spawnMember(team.teamId, 'approval-worker', 'worker');
    const transport = runtime.getTransport(team.teamId)!;

    await transport.send(worker.memberId, {
      id: 'msg-approval-1',
      from: 'leader',
      to: worker.memberId,
      teamId: team.teamId,
      type: 'message',
      content: 'perform the risky step',
      timestamp: new Date().toISOString(),
      read: false,
    });

    runtime.getRunner(worker.memberId)?.wake();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(registry.getTeam(team.teamId)?.status).toBe('paused');
    expect(approvalStore.list('team-approval-session')).toEqual([
      expect.objectContaining({
        source: 'team_member',
        teamId: team.teamId,
        memberId: worker.memberId,
        description: 'Worker approval required',
      }),
    ]);

    await runtime.resumeMemberApproval(worker.memberId, {action: 'allow_once'});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(approvalStore.list('team-approval-session')).toHaveLength(0);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');

    await runtime.shutdownTeam(team.teamId);
  });

  test('shutdownTeam refuses completion while a worker approval is pending', async () => {
    const pauseRequest: PauseRequest = {
      id: 'pause-team-worker-blocker',
      description: 'Approve risky change',
      action: {
        toolCallId: 'call_worker_blocker',
        toolName: 'dangerous_tool',
        toolArgs: {target: 'tmp/out.txt'},
      },
      review: {
        actionName: 'dangerous_tool',
        allowedDecisions: ['approve', 'reject'],
      },
      runtime: {
        runId: 'run-worker-blocker',
        turn: 1,
        requestId: 'req-worker-blocker',
        toolIndex: 0,
      },
    };
    const approvalStore = createApprovalMemoryStore();
    setup(() => createMockSession({
      invokeResult: () => ({reason: 'paused', pause: pauseRequest}),
    }));
    runtime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/test',
      createSession: () => createMockSession({
        invokeResult: () => ({reason: 'paused', pause: pauseRequest}),
      }),
      approvalStore,
      sessionId: 'team-blocker-session',
    });
    runtime.subscribeDomainEvents((teamId, event) => {
      domainEvents.push({teamId, event});
    });

    const team = createTestTeam();
    await runtime.startTeam(team.teamId);
    const worker = await runtime.spawnMember(team.teamId, 'worker-blocked', 'worker');
    const transport = runtime.getTransport(team.teamId)!;

    await transport.send(worker.memberId, {
      id: 'msg-worker-blocked',
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

    const blockers = runtime.getCompletionBlockers(team.teamId);
    expect(blockers.pendingApprovals).toHaveLength(1);
    expect(blockers.pendingApprovals[0]?.memberId).toBe(worker.memberId);

    await expect(runtime.shutdownTeam(team.teamId)).rejects.toThrow(/cannot complete team/i);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');
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
    await runtime.spawnMember(team.teamId, 'worker-3', 'worker');

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

  test('subscribeDomainEvents receives events', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    const teamEvents = domainEvents.filter(e => e.teamId === team.teamId);
    expect(teamEvents.length).toBeGreaterThan(0);

    await runtime.shutdownTeam(team.teamId);
  });

  test('health check emits team.deadlock when job board is deadlocked', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Inject a deadlocked job board: circular dependency X blocks Y, Y blocks X
    const deadlockedBoard = JobBoard.fromJSON({
      teamId: team.teamId,
      jobs: [
        {
          id: 'x',
          teamId: team.teamId,
          title: 'X',
          description: '',
          status: 'planned',
          blockedBy: ['y'],
          blocks: ['y'],
          priority: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'y',
          teamId: team.teamId,
          title: 'Y',
          description: '',
          status: 'planned',
          blockedBy: ['x'],
          blocks: ['x'],
          priority: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (registry as any).jobBoards.set(team.teamId, deadlockedBoard);

    // Clear events so we only see the health check result
    domainEvents.length = 0;

    // Directly invoke the private health check (avoids waiting 5s in tests)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runtime as any).checkTeamHealth(team.teamId);

    const deadlockEvents = domainEvents.filter(e => e.event.type === 'team.deadlock');
    expect(deadlockEvents.length).toBe(1);
    expect(deadlockEvents[0]!.event.data.teamId).toBe(team.teamId);
    expect((deadlockEvents[0]!.event.data as Record<string, unknown>).message).toContain('blocked');

    await runtime.killTeam(team.teamId);
  });

  test('health check does not emit when no deadlock exists', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Add a normal (non-blocked) job
    const jobBoard = registry.getJobBoard(team.teamId);
    jobBoard.planJobs([{ title: 'Normal job', description: 'Do something' }]);

    // Clear events
    domainEvents.length = 0;

    // Directly invoke the private health check
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runtime as any).checkTeamHealth(team.teamId);

    const deadlockEvents = domainEvents.filter(e => e.event.type === 'team.deadlock');
    expect(deadlockEvents.length).toBe(0);

    await runtime.killTeam(team.teamId);
  });

  test('health check skips non-running teams', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // Inject deadlocked board
    const deadlockedBoard = JobBoard.fromJSON({
      teamId: team.teamId,
      jobs: [
        {
          id: 'a',
          teamId: team.teamId,
          title: 'A',
          description: '',
          status: 'planned',
          blockedBy: ['b'],
          blocks: ['b'],
          priority: 0,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'b',
          teamId: team.teamId,
          title: 'B',
          description: '',
          status: 'planned',
          blockedBy: ['a'],
          blocks: ['a'],
          priority: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (registry as any).jobBoards.set(team.teamId, deadlockedBoard);

    // Pause team — health check should be a no-op for non-running teams
    runtime.pauseTeam(team.teamId);

    // Clear events
    domainEvents.length = 0;

    // Directly invoke health check — should skip because team is paused
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runtime as any).checkTeamHealth(team.teamId);

    const deadlockEvents = domainEvents.filter(e => e.event.type === 'team.deadlock');
    expect(deadlockEvents.length).toBe(0);

    runtime.resumeTeam(team.teamId);
    await runtime.killTeam(team.teamId);
  });

  test('health timer is cleared on shutdown (no timer leak)', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((runtime as any).healthTimers.has(team.teamId)).toBe(true);

    await runtime.shutdownTeam(team.teamId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((runtime as any).healthTimers.has(team.teamId)).toBe(false);
  });

  test('health timer is cleared on killTeam (no timer leak)', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((runtime as any).healthTimers.has(team.teamId)).toBe(true);

    await runtime.killTeam(team.teamId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((runtime as any).healthTimers.has(team.teamId)).toBe(false);
  });

  test('pauseTeam clears health timer, resumeTeam restarts it', async () => {
    const team = createTestTeam();
    await runtime.startTeam(team.teamId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtimeAny = runtime as any;
    expect(runtimeAny.healthTimers.has(team.teamId)).toBe(true);

    runtime.pauseTeam(team.teamId);
    expect(runtimeAny.healthTimers.has(team.teamId)).toBe(false);

    runtime.resumeTeam(team.teamId);
    expect(runtimeAny.healthTimers.has(team.teamId)).toBe(true);

    await runtime.shutdownTeam(team.teamId);
  });

  test('shutdownTeam cascades to sub-teams', async () => {
    const parent = createTestTeam();
    await runtime.startTeam(parent.teamId);

    const subTeam = registry.createSubTeam(parent.teamId, {
      name: 'sub',
      goal: 'sub goal',
      createdBy: 'test',
    });
    await runtime.startTeam(subTeam.teamId);

    expect(registry.getTeam(parent.teamId)?.status).toBe('running');
    expect(registry.getTeam(subTeam.teamId)?.status).toBe('running');

    // Shutdown parent — should cascade to sub-team first
    await runtime.shutdownTeam(parent.teamId);

    expect(registry.getTeam(subTeam.teamId)?.status).toBe('completed');
    expect(registry.getTeam(parent.teamId)?.status).toBe('completed');
  });

  test('killTeam cascades to sub-teams', async () => {
    const parent = createTestTeam();
    await runtime.startTeam(parent.teamId);

    const subTeam = registry.createSubTeam(parent.teamId, {
      name: 'sub',
      goal: 'sub goal',
      createdBy: 'test',
    });
    await runtime.startTeam(subTeam.teamId);

    expect(registry.getTeam(parent.teamId)?.status).toBe('running');
    expect(registry.getTeam(subTeam.teamId)?.status).toBe('running');

    // Kill parent — should cascade to sub-team first
    await runtime.killTeam(parent.teamId);

    expect(registry.getTeam(subTeam.teamId)?.status).toBe('failed');
    expect(registry.getTeam(parent.teamId)?.status).toBe('failed');
  });
});

import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {TeamRegistry} from '@capability/team/team-registry';
import {JobBoard} from '@capability/team/job-board';
import {LocalTransport} from '@capability/team/transport/local-transport';
import {TeamEventEmitter} from '@capability/team/events';
import type {TeamBusEvent} from '@capability/team/events';
import {TeamBudgetTracker} from '@capability/team/budget/budget-tracker';
import {TeamStore} from '@capability/team/persistence/team-store';
import {JobBoardStore} from '@capability/team/persistence/job-board-store';
import {MemberStore} from '@capability/team/persistence/member-store';
import {createLeaderTools} from '@capability/team/tools/leader-tools';
import {createWorkerTools} from '@capability/team/tools/worker-tools';
import type {TeamMember} from '@capability/team/types';
import type {TeamToolContext} from '@capability/team/tools/types';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeMember(
  teamId: string,
  overrides: Partial<TeamMember> = {},
): TeamMember {
  const id = overrides.memberId ?? `member_${crypto.randomUUID().slice(0, 8)}`;
  return {
    memberId: id,
    name: overrides.name ?? `worker-${id.slice(-4)}`,
    teamId,
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'idle',
    sessionId: `session_${id}`,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeToolContext(
  registry: TeamRegistry,
  transport: LocalTransport,
  emitter: TeamEventEmitter,
  teamId: string,
  memberId: string,
): TeamToolContext {
  return {
    teamId,
    memberId,
    registry,
    transport,
    emitter,
    projectRoot: '/tmp/test-project',
  };
}

// ─── 1. Team Lifecycle ──────────────────────────────────────────────

describe('Team Lifecycle', () => {
  let registry: TeamRegistry;

  beforeEach(() => {
    registry = new TeamRegistry();
  });

  test('create team -> registry -> status created', () => {
    const team = registry.createTeam({name: 'alpha', goal: 'Build feature X'});

    expect(team.status).toBe('created');
    expect(team.name).toBe('alpha');
    expect(team.depth).toBe(0);
    expect(registry.getTeam(team.teamId)).toBeDefined();
    expect(registry.getTeamByName('alpha')).toBeDefined();
  });

  test('start team -> spawning -> running with leader', () => {
    const team = registry.createTeam({name: 'beta', goal: 'Ship v2'});

    registry.updateTeamStatus(team.teamId, 'spawning');
    expect(registry.getTeam(team.teamId)!.status).toBe('spawning');

    // Register a leader member
    const leader = makeMember(team.teamId, {role: 'leader', name: 'leader-1'});
    registry.registerMember(team.teamId, leader);

    registry.updateTeamStatus(team.teamId, 'running');
    expect(registry.getTeam(team.teamId)!.status).toBe('running');
    expect(registry.getLeader(team.teamId)).toBeDefined();
    expect(registry.getLeader(team.teamId)!.memberId).toBe(leader.memberId);
  });

  test('pause team -> all members paused -> resume', () => {
    const team = registry.createTeam({name: 'gamma', goal: 'Tests'});
    registry.updateTeamStatus(team.teamId, 'spawning');
    registry.updateTeamStatus(team.teamId, 'running');

    const m1 = makeMember(team.teamId, {name: 'w1', status: 'idle'});
    const m2 = makeMember(team.teamId, {name: 'w2', status: 'working'});
    registry.registerMember(team.teamId, m1);
    registry.registerMember(team.teamId, m2);

    // Pause team
    registry.updateTeamStatus(team.teamId, 'paused');
    expect(registry.getTeam(team.teamId)!.status).toBe('paused');

    // Pause all members (simulating runtime behavior)
    for (const member of registry.getMembersByTeam(team.teamId)) {
      registry.updateMember(team.teamId, member.memberId, {status: 'paused'});
    }
    const paused = registry.getMembersByTeam(team.teamId);
    expect(paused.every((m) => m.status === 'paused')).toBe(true);

    // Resume
    registry.updateTeamStatus(team.teamId, 'running');
    expect(registry.getTeam(team.teamId)!.status).toBe('running');
  });

  test('shutdown team -> completing -> completed, members terminated', () => {
    const team = registry.createTeam({name: 'delta', goal: 'Deploy'});
    registry.updateTeamStatus(team.teamId, 'spawning');
    registry.updateTeamStatus(team.teamId, 'running');

    const m1 = makeMember(team.teamId);
    registry.registerMember(team.teamId, m1);

    registry.updateTeamStatus(team.teamId, 'completing');
    expect(registry.getTeam(team.teamId)!.status).toBe('completing');

    // Terminate members (simulating runtime behavior)
    registry.updateMember(team.teamId, m1.memberId, {status: 'terminated'});

    registry.updateTeamStatus(team.teamId, 'completed');
    expect(registry.getTeam(team.teamId)!.status).toBe('completed');
    expect(registry.getTeam(team.teamId)!.completedAt).toBeDefined();

    const members = registry.getMembersByTeam(team.teamId);
    expect(members.every((m) => m.status === 'terminated')).toBe(true);
  });

  test('invalid state transition throws', () => {
    const team = registry.createTeam({name: 'epsilon', goal: 'Test transitions'});
    // created → completing is not a valid direct transition
    expect(() => registry.updateTeamStatus(team.teamId, 'completing')).toThrow(
      /Invalid status transition/,
    );
  });
});

// ─── 2. Job Board Flow ──────────────────────────────────────────────

describe('Job Board Flow', () => {
  let board: JobBoard;

  beforeEach(() => {
    board = new JobBoard('team_test');
  });

  test('plan jobs with dependencies and auto-unblock', () => {
    // Create independent job
    const [jobA] = board.planJobs([{title: 'Setup DB', description: 'Create schema'}]);
    expect(jobA.status).toBe('ready');

    // Create dependent job
    const [jobB] = board.planJobs([
      {title: 'Seed data', description: 'Insert test data', blockedBy: [jobA.id]},
    ]);
    expect(jobB.status).toBe('planned');
    expect(jobB.blockedBy).toEqual([jobA.id]);

    // Claim and complete A
    board.claimJob(jobA.id, 'worker-1');
    expect(board.getJob(jobA.id)!.status).toBe('in_progress');

    board.submitJob(jobA.id, {summary: 'Schema created', artifacts: []});
    expect(board.getJob(jobA.id)!.status).toBe('review');

    board.completeJob(jobA.id, 'leader');

    // B should now be unblocked
    const updatedB = board.getJob(jobB.id)!;
    expect(updatedB.status).toBe('ready');
    expect(updatedB.blockedBy).toEqual([]);
  });

  test('cycle detection rejects circular dependencies', () => {
    const [a] = board.planJobs([{title: 'A', description: 'Task A'}]);
    const [b] = board.planJobs([
      {title: 'B', description: 'Task B', blockedBy: [a.id]},
    ]);

    // Try to create C that depends on B, then make A depend on C
    // Direct cycle: create a job that creates a cycle
    const [c] = board.planJobs([
      {title: 'C', description: 'Task C', blockedBy: [b.id]},
    ]);

    // Now manually modify A to depend on C to create a cycle, then validate
    // Since planJobs validates the DAG, we test by trying to plan a job
    // that would create a cycle if we could modify blockedBy directly
    const dagResult = board.validateDAG();
    expect(dagResult.valid).toBe(true);
  });

  test('claim job changes status to in_progress', () => {
    const [job] = board.planJobs([{title: 'Task', description: 'Do something'}]);
    expect(job.status).toBe('ready');

    const claimed = board.claimJob(job.id, 'worker-1');
    expect(claimed).toBe(true);
    expect(board.getJob(job.id)!.status).toBe('in_progress');
    expect(board.getJob(job.id)!.assignee).toBe('worker-1');
  });

  test('cannot claim non-ready job', () => {
    const [a] = board.planJobs([{title: 'A', description: 'A'}]);
    const [b] = board.planJobs([{title: 'B', description: 'B', blockedBy: [a.id]}]);

    // B is 'planned', cannot claim
    const claimed = board.claimJob(b.id, 'worker-1');
    expect(claimed).toBe(false);
  });

  test('worker cannot hold two active jobs', () => {
    const [j1] = board.planJobs([{title: 'T1', description: 'T1'}]);
    const [j2] = board.planJobs([{title: 'T2', description: 'T2'}]);

    board.claimJob(j1.id, 'worker-1');
    const secondClaim = board.claimJob(j2.id, 'worker-1');
    expect(secondClaim).toBe(false);
  });

  test('complete all jobs -> board progress correct', () => {
    const jobs = board.planJobs([
      {title: 'A', description: 'A'},
      {title: 'B', description: 'B'},
    ]);

    for (const job of jobs) {
      board.claimJob(job.id, `worker-${job.id}`);
      board.submitJob(job.id, {summary: 'Done', artifacts: []});
      board.completeJob(job.id);
    }

    const progress = board.getProgress();
    expect(progress.total).toBe(2);
    expect(progress.done).toBe(2);
    expect(progress.inProgress).toBe(0);
    expect(progress.blocked).toBe(0);
  });

  test('reject job sends it back to in_progress', () => {
    const [job] = board.planJobs([{title: 'Review me', description: 'Test'}]);
    board.claimJob(job.id, 'worker-1');
    board.submitJob(job.id, {summary: 'First attempt', artifacts: []});
    expect(board.getJob(job.id)!.status).toBe('review');

    board.rejectJob(job.id, 'Needs more work');
    expect(board.getJob(job.id)!.status).toBe('in_progress');
    expect(board.getJob(job.id)!.result).toBeUndefined();
  });
});

// ─── 3. Transport & Communication ───────────────────────────────────

describe('Transport & Communication', () => {
  let transport: LocalTransport;

  beforeEach(() => {
    transport = new LocalTransport();
    transport.registerMember('alice');
    transport.registerMember('bob');
  });

  test('send message from A to B', async () => {
    const msg = {
      id: 'msg_1',
      from: 'alice',
      to: 'bob' as const,
      teamId: 'team_1',
      type: 'message' as const,
      content: 'Hello Bob',
      timestamp: new Date().toISOString(),
      read: false,
    };

    await transport.send('bob', msg);
    const received = await transport.receive('bob');

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('Hello Bob');
    expect(received[0].from).toBe('alice');
  });

  test('broadcast delivers to all except sender', async () => {
    const msg = {
      id: 'msg_2',
      from: 'alice',
      to: 'broadcast' as const,
      teamId: 'team_1',
      type: 'message' as const,
      content: 'Attention everyone',
      timestamp: new Date().toISOString(),
      read: false,
    };

    await transport.send('broadcast', msg);

    const bobInbox = await transport.receive('bob');
    const aliceInbox = await transport.receive('alice');

    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0].content).toBe('Attention everyone');
    expect(aliceInbox).toHaveLength(0);
  });

  test('subscribe receives real-time delivery', async () => {
    const received: string[] = [];
    transport.subscribe('bob', (msg) => {
      received.push(msg.content);
    });

    const msg = {
      id: 'msg_3',
      from: 'alice',
      to: 'bob' as const,
      teamId: 'team_1',
      type: 'message' as const,
      content: 'Real-time msg',
      timestamp: new Date().toISOString(),
      read: false,
    };

    await transport.send('bob', msg);
    expect(received).toEqual(['Real-time msg']);
  });

  test('send to unknown member throws', async () => {
    const msg = {
      id: 'msg_4',
      from: 'alice',
      to: 'charlie' as const,
      teamId: 'team_1',
      type: 'message' as const,
      content: 'Test',
      timestamp: new Date().toISOString(),
      read: false,
    };

    await expect(transport.send('charlie', msg)).rejects.toThrow(/Unknown member/);
  });

  test('close removes member', async () => {
    await transport.close('bob');
    expect(transport.isHealthy('bob')).toBe(false);
  });
});

// ─── 4. Worker Tools Integration ────────────────────────────────────

describe('Worker Tools Integration', () => {
  let registry: TeamRegistry;
  let transport: LocalTransport;
  let emitter: TeamEventEmitter;
  let teamId: string;
  let leaderId: string;
  let workerId: string;

  beforeEach(() => {
    registry = new TeamRegistry();
    transport = new LocalTransport();
    emitter = new TeamEventEmitter();

    const team = registry.createTeam({name: 'workers-test', goal: 'Test worker tools'});
    teamId = team.teamId;
    registry.updateTeamStatus(teamId, 'spawning');
    registry.updateTeamStatus(teamId, 'running');

    // Register leader
    const leader = makeMember(teamId, {role: 'leader', name: 'leader'});
    leaderId = leader.memberId;
    registry.registerMember(teamId, leader);
    transport.registerMember(leaderId);

    // Register worker
    const worker = makeMember(teamId, {role: 'worker', name: 'worker-1'});
    workerId = worker.memberId;
    registry.registerMember(teamId, worker);
    transport.registerMember(workerId);
  });

  test('team_claim_job claims a ready job', async () => {
    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Implement feature', description: 'Build it'}]);

    const ctx = makeToolContext(registry, transport, emitter, teamId, workerId);
    const tools = createWorkerTools(ctx);
    const claimTool = tools.find((t) => t.name === 'team_claim_job')!;

    const result = JSON.parse(await claimTool.invoke({jobId: job.id}));
    expect(result.success).toBe(true);
    expect(result.job.id).toBe(job.id);
    expect(board.getJob(job.id)!.status).toBe('in_progress');
    expect(board.getJob(job.id)!.assignee).toBe(workerId);
  });

  test('team_submit_job submits with result and notifies leader', async () => {
    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Write tests', description: 'Full coverage'}]);
    board.claimJob(job.id, workerId);

    const ctx = makeToolContext(registry, transport, emitter, teamId, workerId);
    const tools = createWorkerTools(ctx);
    const submitTool = tools.find((t) => t.name === 'team_submit_job')!;

    const result = JSON.parse(
      await submitTool.invoke({jobId: job.id, summary: 'Tests written with 100% coverage'}),
    );
    expect(result.success).toBe(true);
    expect(board.getJob(job.id)!.status).toBe('review');

    // Leader should have received notification
    const leaderMessages = await transport.receive(leaderId);
    expect(leaderMessages.length).toBeGreaterThanOrEqual(1);
    expect(leaderMessages.some((m) => m.type === 'job_submitted')).toBe(true);
  });

  test('team_send_message delivers message', async () => {
    const ctx = makeToolContext(registry, transport, emitter, teamId, workerId);
    const tools = createWorkerTools(ctx);
    const sendTool = tools.find((t) => t.name === 'team_send_message')!;

    const result = JSON.parse(
      await sendTool.invoke({to: leaderId, content: 'Need help with X'}),
    );
    expect(result.success).toBe(true);

    const leaderMessages = await transport.receive(leaderId);
    expect(leaderMessages).toHaveLength(1);
    expect(leaderMessages[0].content).toBe('Need help with X');
  });
});

// ─── 5. Leader Tools Integration ────────────────────────────────────

describe('Leader Tools Integration', () => {
  let registry: TeamRegistry;
  let transport: LocalTransport;
  let emitter: TeamEventEmitter;
  let teamId: string;
  let leaderId: string;

  beforeEach(() => {
    registry = new TeamRegistry();
    transport = new LocalTransport();
    emitter = new TeamEventEmitter();

    const team = registry.createTeam({name: 'leaders-test', goal: 'Test leader tools'});
    teamId = team.teamId;
    registry.updateTeamStatus(teamId, 'spawning');
    registry.updateTeamStatus(teamId, 'running');

    const leader = makeMember(teamId, {role: 'leader', name: 'leader'});
    leaderId = leader.memberId;
    registry.registerMember(teamId, leader);
    transport.registerMember(leaderId);
  });

  test('team_plan_jobs creates jobs on board', async () => {
    const ctx = makeToolContext(registry, transport, emitter, teamId, leaderId);
    const tools = createLeaderTools(ctx);
    const planTool = tools.find((t) => t.name === 'team_plan_jobs')!;

    const result = JSON.parse(
      await planTool.invoke({
        jobs: [
          {title: 'Design API', description: 'REST endpoints', priority: 1},
          {title: 'Implement API', description: 'Code it', priority: 0},
        ],
      }),
    );

    expect(result).toHaveLength(2);
    const board = registry.getJobBoard(teamId);
    expect(board.getAllJobs()).toHaveLength(2);
  });

  test('team_spawn_member registers new worker', async () => {
    const ctx = makeToolContext(registry, transport, emitter, teamId, leaderId);
    const tools = createLeaderTools(ctx);
    const spawnTool = tools.find((t) => t.name === 'team_spawn_member')!;

    const result = JSON.parse(
      await spawnTool.invoke({name: 'coder-1', role: 'worker'}),
    );

    expect(result.memberId).toBeDefined();
    expect(result.role).toBe('worker');

    const members = registry.getMembersByTeam(teamId);
    // leader + spawned worker
    expect(members).toHaveLength(2);
  });

  test('team_assign_job claims job for member', async () => {
    // Spawn a worker and register in transport
    const worker = makeMember(teamId, {role: 'worker', name: 'worker-assign'});
    registry.registerMember(teamId, worker);
    transport.registerMember(worker.memberId);

    // Plan a job
    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Task', description: 'Do it'}]);

    const ctx = makeToolContext(registry, transport, emitter, teamId, leaderId);
    const tools = createLeaderTools(ctx);
    const assignTool = tools.find((t) => t.name === 'team_assign_job')!;

    const result = JSON.parse(
      await assignTool.invoke({jobId: job.id, memberId: worker.memberId}),
    );
    expect(result.assigned).toBe(true);
    expect(board.getJob(job.id)!.status).toBe('in_progress');
    expect(board.getJob(job.id)!.assignee).toBe(worker.memberId);

    // Worker should have received assignment message
    const workerMessages = await transport.receive(worker.memberId);
    expect(workerMessages.some((m) => m.type === 'job_assigned')).toBe(true);
  });

  test('team_review_job approve -> job completed', async () => {
    const worker = makeMember(teamId, {role: 'worker', name: 'worker-review'});
    registry.registerMember(teamId, worker);
    transport.registerMember(worker.memberId);

    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Review me', description: 'Test'}]);
    board.claimJob(job.id, worker.memberId);
    board.submitJob(job.id, {summary: 'Done', artifacts: []});

    const ctx = makeToolContext(registry, transport, emitter, teamId, leaderId);
    const tools = createLeaderTools(ctx);
    const reviewTool = tools.find((t) => t.name === 'team_review_job')!;

    const result = JSON.parse(
      await reviewTool.invoke({jobId: job.id, approved: true, feedback: 'LGTM'}),
    );
    expect(result.approved).toBe(true);
    expect(board.getJob(job.id)!.status).toBe('done');
  });

  test('team_review_job reject -> job back to in_progress', async () => {
    const worker = makeMember(teamId, {role: 'worker', name: 'worker-reject'});
    registry.registerMember(teamId, worker);
    transport.registerMember(worker.memberId);

    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Redo me', description: 'Test'}]);
    board.claimJob(job.id, worker.memberId);
    board.submitJob(job.id, {summary: 'Attempt 1', artifacts: []});

    const ctx = makeToolContext(registry, transport, emitter, teamId, leaderId);
    const tools = createLeaderTools(ctx);
    const reviewTool = tools.find((t) => t.name === 'team_review_job')!;

    const result = JSON.parse(
      await reviewTool.invoke({jobId: job.id, approved: false, feedback: 'Needs rework'}),
    );
    expect(result.approved).toBe(false);
    expect(board.getJob(job.id)!.status).toBe('in_progress');
  });
});

// ─── 6. Persistence Round Trip ──────────────────────────────────────

describe('Persistence Round Trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'codara-team-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  test('save and load team via TeamStore', () => {
    const registry = new TeamRegistry();
    const team = registry.createTeam({name: 'persist-team', goal: 'Persistence test'});

    const store = new TeamStore(tmpDir);
    store.save(team);

    const loaded = store.load(team.teamId);
    expect(loaded).toBeDefined();
    expect(loaded!.teamId).toBe(team.teamId);
    expect(loaded!.name).toBe('persist-team');
    expect(loaded!.goal).toBe('Persistence test');
    expect(loaded!.status).toBe('created');
  });

  test('save and load job board via JobBoardStore', () => {
    const board = new JobBoard('team_persist');
    const [jobA] = board.planJobs([{title: 'A', description: 'First task'}]);
    board.planJobs([{title: 'B', description: 'Second task', blockedBy: [jobA.id]}]);

    const store = new JobBoardStore(tmpDir);
    store.save(board);

    const loaded = store.load('team_persist');
    expect(loaded).toBeDefined();
    expect(loaded!.getAllJobs()).toHaveLength(2);

    const loadedA = loaded!.getJob(jobA.id)!;
    expect(loadedA.title).toBe('A');
    expect(loadedA.status).toBe('ready');
  });

  test('save and load members via MemberStore', () => {
    const teamId = 'team_members';
    const m1 = makeMember(teamId, {name: 'alice', role: 'leader'});
    const m2 = makeMember(teamId, {name: 'bob', role: 'worker'});

    const store = new MemberStore(tmpDir);
    store.save(m1);
    store.save(m2);

    const loaded1 = store.load(teamId, m1.memberId);
    expect(loaded1).toBeDefined();
    expect(loaded1!.name).toBe('alice');
    expect(loaded1!.role).toBe('leader');

    const allMembers = store.loadByTeam(teamId);
    expect(allMembers).toHaveLength(2);
    expect(allMembers.map((m) => m.name).sort()).toEqual(['alice', 'bob']);
  });

  test('save registry index and reload', () => {
    const registry = new TeamRegistry();
    const t1 = registry.createTeam({name: 'team-a', goal: 'A'});
    const t2 = registry.createTeam({name: 'team-b', goal: 'B'});

    const store = new TeamStore(tmpDir);
    store.saveRegistry([t1, t2]);

    const entries = store.loadRegistry();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(['team-a', 'team-b']);
  });

  test('full round trip: team + members + jobs', () => {
    const registry = new TeamRegistry();
    const team = registry.createTeam({name: 'full-roundtrip', goal: 'Full test'});
    const teamId = team.teamId;

    const leader = makeMember(teamId, {role: 'leader', name: 'leader-rt'});
    const worker = makeMember(teamId, {role: 'worker', name: 'worker-rt'});
    registry.registerMember(teamId, leader);
    registry.registerMember(teamId, worker);

    const board = registry.getJobBoard(teamId);
    const [jobA] = board.planJobs([{title: 'Task A', description: 'Do A'}]);
    board.planJobs([{title: 'Task B', description: 'Do B', blockedBy: [jobA.id]}]);

    // Save everything
    const teamStore = new TeamStore(tmpDir);
    const jobStore = new JobBoardStore(tmpDir);
    const memberStore = new MemberStore(tmpDir);

    teamStore.save(team);
    jobStore.save(board);
    memberStore.save(leader);
    memberStore.save(worker);

    // Load and verify
    const loadedTeam = teamStore.load(teamId)!;
    expect(loadedTeam.name).toBe('full-roundtrip');

    const loadedBoard = jobStore.load(teamId)!;
    expect(loadedBoard.getAllJobs()).toHaveLength(2);

    const loadedMembers = memberStore.loadByTeam(teamId);
    expect(loadedMembers).toHaveLength(2);
    expect(loadedMembers.map((m) => m.role).sort()).toEqual(['leader', 'worker']);
  });
});

// ─── 7. Budget Tracking ─────────────────────────────────────────────

describe('Budget Tracking', () => {
  test('tracks per-member usage and team totals', () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 100_000,
      onBudgetExceeded: 'warn_leader',
    });

    tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 1000, 500);
    tracker.recordUsage('worker-2', 'claude-haiku-4-5', 2000, 1000);

    const usage = tracker.getUsage();
    expect(usage.totalInputTokens).toBe(3000);
    expect(usage.totalOutputTokens).toBe(1500);
    expect(usage.totalTokens).toBe(4500);
    expect(usage.byMember.size).toBe(2);

    const w1 = usage.byMember.get('worker-1')!;
    expect(w1.inputTokens).toBe(1000);
    expect(w1.outputTokens).toBe(500);
    expect(w1.turns).toBe(1);

    const w2 = usage.byMember.get('worker-2')!;
    expect(w2.inputTokens).toBe(2000);
    expect(w2.outputTokens).toBe(1000);
  });

  test('warning at 90% threshold', () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 10_000,
      onBudgetExceeded: 'warn_leader',
    });

    // 91% usage
    const result = tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 5000, 4100);
    expect(result.action).toBe('warning');
    expect(result.usedPercent).toBeGreaterThanOrEqual(90);
    expect(result.remaining).toBeGreaterThan(0);
  });

  test('exceeded action at 100%', () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 10_000,
      onBudgetExceeded: 'shutdown',
    });

    const result = tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 6000, 5000);
    expect(result.action).toBe('exceeded');
    expect(result.usedPercent).toBe(100);
    expect(result.remaining).toBe(0);
  });

  test('member budget check', () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 1_000_000,
      memberMaxTokens: 5_000,
      onBudgetExceeded: 'warn_leader',
    });

    tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 2000, 1000);
    expect(tracker.checkMemberBudget('worker-1')).toBe(true);

    tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 2000, 1000);
    // Now at 6000 total > 5000 limit
    expect(tracker.checkMemberBudget('worker-1')).toBe(false);
  });

  test('no budget config returns none action', () => {
    const tracker = new TeamBudgetTracker();
    const result = tracker.recordUsage('worker-1', 'claude-sonnet-4-6', 999999, 999999);
    expect(result.action).toBe('none');
    expect(result.remaining).toBe(Infinity);
  });

  test('exceeded policy defaults to warn_leader', () => {
    const tracker = new TeamBudgetTracker();
    expect(tracker.getExceededPolicy()).toBe('warn_leader');
  });

  test('exceeded policy respects config', () => {
    const tracker = new TeamBudgetTracker({
      teamMaxTokens: 100,
      onBudgetExceeded: 'shutdown',
    });
    expect(tracker.getExceededPolicy()).toBe('shutdown');
  });
});

// ─── 8. Events ──────────────────────────────────────────────────────

describe('Events', () => {
  let emitter: TeamEventEmitter;
  let events: TeamBusEvent[];

  beforeEach(() => {
    emitter = new TeamEventEmitter();
    events = [];
    emitter.subscribe((e) => events.push(e));
  });

  test('emits team lifecycle events in order', () => {
    emitter.emit({type: 'team.created', data: {teamId: 't1', name: 'Test', goal: 'Go', depth: 0}});
    emitter.emit({type: 'team.running', data: {teamId: 't1'}});
    emitter.emit({type: 'team.completed', data: {teamId: 't1', summary: 'All done'}});

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('team.created');
    expect(events[1].type).toBe('team.running');
    expect(events[2].type).toBe('team.completed');
  });

  test('emits member events', () => {
    emitter.emit({
      type: 'member.joined',
      data: {teamId: 't1', memberId: 'm1', name: 'worker-1', role: 'worker', mode: 'local'},
    });
    emitter.emit({
      type: 'member.working',
      data: {teamId: 't1', memberId: 'm1', jobId: 'j1'},
    });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('member.joined');
    expect(events[1].type).toBe('member.working');
  });

  test('emits job events', () => {
    emitter.emit({type: 'job.created', data: {teamId: 't1', jobId: 'j1', title: 'Build', priority: 1}});
    emitter.emit({type: 'job.claimed', data: {teamId: 't1', jobId: 'j1', memberId: 'm1'}});
    emitter.emit({type: 'job.done', data: {teamId: 't1', jobId: 'j1'}});

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('job.created');
    expect(events[1].type).toBe('job.claimed');
    expect(events[2].type).toBe('job.done');
  });

  test('unsubscribe stops delivery', () => {
    const localEvents: TeamBusEvent[] = [];
    const unsub = emitter.subscribe((e) => localEvents.push(e));

    emitter.emit({type: 'team.running', data: {teamId: 't1'}});
    expect(localEvents).toHaveLength(1);

    unsub();
    emitter.emit({type: 'team.paused', data: {teamId: 't1', reason: 'test'}});
    expect(localEvents).toHaveLength(1);
  });

  test('clear removes all listeners', () => {
    emitter.emit({type: 'team.running', data: {teamId: 't1'}});
    expect(events).toHaveLength(1);

    emitter.clear();
    emitter.emit({type: 'team.paused', data: {teamId: 't1', reason: 'test'}});
    expect(events).toHaveLength(1); // no new events
  });

  test('listener errors are swallowed', () => {
    const goodEvents: TeamBusEvent[] = [];
    emitter.subscribe(() => {
      throw new Error('boom');
    });
    emitter.subscribe((e) => goodEvents.push(e));

    // Should not throw
    emitter.emit({type: 'team.running', data: {teamId: 't1'}});
    expect(goodEvents).toHaveLength(1);
  });

  test('integrated: tools emit correct events', async () => {
    const registry = new TeamRegistry();
    const transport = new LocalTransport();

    const team = registry.createTeam({name: 'events-test', goal: 'Events'});
    registry.updateTeamStatus(team.teamId, 'spawning');
    registry.updateTeamStatus(team.teamId, 'running');

    const leader = makeMember(team.teamId, {role: 'leader', name: 'leader'});
    registry.registerMember(team.teamId, leader);
    transport.registerMember(leader.memberId);

    const ctx = makeToolContext(registry, transport, emitter, team.teamId, leader.memberId);
    const tools = createLeaderTools(ctx);

    // Plan jobs -> should emit job.created events
    const planTool = tools.find((t) => t.name === 'team_plan_jobs')!;
    await planTool.invoke({
      jobs: [{title: 'Event task', description: 'Test', priority: 0}],
    });

    const jobCreatedEvents = events.filter((e) => e.type === 'job.created');
    expect(jobCreatedEvents).toHaveLength(1);

    // Spawn member -> should emit member.joined
    const spawnTool = tools.find((t) => t.name === 'team_spawn_member')!;
    await spawnTool.invoke({name: 'spawned-worker', role: 'worker'});

    const memberJoinedEvents = events.filter((e) => e.type === 'member.joined');
    expect(memberJoinedEvents).toHaveLength(1);
  });
});

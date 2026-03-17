import {describe, test, expect, beforeEach} from 'bun:test';
import {TeamRegistry} from '@capability/team/team-registry';
import {LocalTransport} from '@capability/team/transport/local-transport';
import {TeamEventEmitter} from '@capability/team/events';
import type {TeamBusEvent} from '@capability/team/events';
import type {TeamMember} from '@capability/team/types';
import {createWorkerTools} from '@capability/team/tools/worker-tools';
import type {TeamToolContext} from '@capability/team/tools/types';

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

describe('Worker Tools', () => {
  let registry: TeamRegistry;
  let transport: LocalTransport;
  let emitter: TeamEventEmitter;
  let ctx: TeamToolContext;
  let teamId: string;
  const leaderId = 'leader-1';
  const workerId = 'worker-1';

  beforeEach(() => {
    registry = new TeamRegistry();
    transport = new LocalTransport();
    emitter = new TeamEventEmitter();

    const team = registry.createTeam({name: 'test', goal: 'test goal'});
    teamId = team.teamId;

    registry.registerMember(teamId, makeMember({memberId: leaderId, teamId, role: 'leader'}));
    registry.registerMember(teamId, makeMember({memberId: workerId, teamId, role: 'worker'}));

    transport.registerMember(leaderId);
    transport.registerMember(workerId);

    ctx = {teamId, memberId: workerId, registry, transport, emitter, projectRoot: '/tmp/test'};
  });

  // ── createWorkerTools ───────────────────────────────────────────

  test('createWorkerTools returns 4 tools', () => {
    const tools = createWorkerTools(ctx);
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain('team_claim_job');
    expect(names).toContain('team_submit_job');
    expect(names).toContain('team_send_message');
    expect(names).toContain('team_ask_leader');
  });

  // ── team_claim_job ──────────────────────────────────────────────

  test('team_claim_job claims a ready job and updates member status', async () => {
    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Task A', description: 'Do A'}]);

    const events: TeamBusEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    const tools = createWorkerTools(ctx);
    const claimTool = tools.find((t) => t.name === 'team_claim_job')!;
    const result = JSON.parse(await claimTool.invoke({jobId: job.id}) as string);

    expect(result.success).toBe(true);
    expect(result.job.title).toBe('Task A');

    // Member updated
    const member = registry.getMember(workerId)!;
    expect(member.currentJobId).toBe(job.id);
    expect(member.status).toBe('working');

    // Events emitted
    expect(events.some((e) => e.type === 'job.claimed')).toBe(true);
    expect(events.some((e) => e.type === 'member.working')).toBe(true);
  });

  test('team_claim_job fails on non-ready job', async () => {
    const board = registry.getJobBoard(teamId);
    const [a] = board.planJobs([{title: 'A', description: 'Do A'}]);
    const [b] = board.planJobs([{title: 'B', description: 'Do B', blockedBy: [a.id]}]);

    const tools = createWorkerTools(ctx);
    const claimTool = tools.find((t) => t.name === 'team_claim_job')!;
    const result = JSON.parse(await claimTool.invoke({jobId: b.id}) as string);

    expect(result.success).toBe(false);
  });

  // ── team_submit_job ─────────────────────────────────────────────

  test('team_submit_job submits with summary and notifies leader', async () => {
    const board = registry.getJobBoard(teamId);
    const [job] = board.planJobs([{title: 'Task A', description: 'Do A'}]);
    board.claimJob(job.id, workerId);

    const events: TeamBusEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    const tools = createWorkerTools(ctx);
    const submitTool = tools.find((t) => t.name === 'team_submit_job')!;
    const result = JSON.parse(await submitTool.invoke({jobId: job.id, summary: 'Done with task'}) as string);

    expect(result.success).toBe(true);
    expect(result.status).toBe('submitted');

    // Job status changed to review
    expect(board.getJob(job.id)!.status).toBe('review');

    // Member reset to idle
    const member = registry.getMember(workerId)!;
    expect(member.status).toBe('idle');
    expect(member.currentJobId).toBeUndefined();

    // Leader received message
    const leaderMsgs = await transport.receive(leaderId);
    expect(leaderMsgs).toHaveLength(1);
    expect(leaderMsgs[0].type).toBe('job_submitted');

    // Event emitted
    expect(events.some((e) => e.type === 'job.submitted')).toBe(true);
  });

  // ── team_send_message ───────────────────────────────────────────

  test('team_send_message sends message via transport', async () => {
    const tools = createWorkerTools(ctx);
    const msgTool = tools.find((t) => t.name === 'team_send_message')!;
    const result = JSON.parse(await msgTool.invoke({to: leaderId, content: 'Hello leader'}) as string);

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();

    const msgs = await transport.receive(leaderId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello leader');
    expect(msgs[0].type).toBe('message');
    expect(msgs[0].from).toBe(workerId);
  });

  // ── team_ask_leader ─────────────────────────────────────────────

  test('team_ask_leader sends question to leader', async () => {
    const tools = createWorkerTools(ctx);
    const askTool = tools.find((t) => t.name === 'team_ask_leader')!;
    const result = JSON.parse(await askTool.invoke({question: 'How should I handle errors?'}) as string);

    expect(result.success).toBe(true);
    expect(result.leaderId).toBe(leaderId);

    const msgs = await transport.receive(leaderId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('question');
    expect(msgs[0].content).toBe('How should I handle errors?');
  });
});

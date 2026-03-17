import {describe, test, expect, beforeEach} from 'bun:test';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {TeamRegistry} from '@capability/team/team-registry';
import {LocalTransport} from '@capability/team/transport/local-transport';
import {TeamEventEmitter} from '@capability/team/events';
import type {TeamBusEvent} from '@capability/team/events';
import type {Team, TeamMember} from '@capability/team/types';
import {createLeaderTools} from '@capability/team/tools/leader-tools';
import type {TeamToolContext} from '@capability/team/tools/leader-tools';

// ─── Helpers ────────────────────────────────────────────────────────

function findTool(tools: StructuredToolInterface[], name: string): StructuredToolInterface {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

function parse(result: unknown): any {
  return JSON.parse(result as string);
}

function makeMember(overrides: Partial<TeamMember> & {memberId: string; teamId: string}): TeamMember {
  return {
    name: overrides.memberId,
    role: 'worker',
    status: 'idle',
    mode: 'local',
    sessionId: `session_${overrides.memberId}`,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Leader Tools', () => {
  let registry: TeamRegistry;
  let transport: LocalTransport;
  let emitter: TeamEventEmitter;
  let tools: StructuredToolInterface[];
  let ctx: TeamToolContext;
  let team: Team;
  let events: TeamBusEvent[];

  beforeEach(() => {
    registry = new TeamRegistry();
    transport = new LocalTransport();
    emitter = new TeamEventEmitter();
    events = [];

    emitter.subscribe((e) => events.push(e));

    team = registry.createTeam({name: 'test-team', goal: 'test goal'});

    const leader = makeMember({memberId: 'leader-1', teamId: team.teamId, role: 'leader'});
    registry.registerMember(team.teamId, leader);
    transport.registerMember(leader.memberId);

    ctx = {
      teamId: team.teamId,
      memberId: leader.memberId,
      registry,
      transport,
      emitter,
      projectRoot: '/tmp/test',
    };

    tools = createLeaderTools(ctx);
  });

  // ── createLeaderTools ───────────────────────────────────────────

  test('returns 14 tools', () => {
    expect(tools).toHaveLength(14);
  });

  test('all tools have unique names', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(14);
  });

  // ── team_plan_jobs ──────────────────────────────────────────────

  describe('team_plan_jobs', () => {
    test('creates jobs on the board', async () => {
      const planTool = findTool(tools, 'team_plan_jobs');
      const result = parse(await planTool.invoke({
        jobs: [
          {title: 'Job A', description: 'Do A'},
          {title: 'Job B', description: 'Do B'},
        ],
      }));

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Job A');
      expect(result[1].title).toBe('Job B');

      const board = registry.getJobBoard(team.teamId);
      expect(board.getAllJobs()).toHaveLength(2);
    });

    test('emits job.created events', async () => {
      const planTool = findTool(tools, 'team_plan_jobs');
      await planTool.invoke({
        jobs: [{title: 'Job X', description: 'Do X'}],
      });

      const created = events.filter((e) => e.type === 'job.created');
      expect(created).toHaveLength(1);
      expect(created[0].data).toMatchObject({teamId: team.teamId, title: 'Job X'});
    });
  });

  // ── team_cancel_job ─────────────────────────────────────────────

  describe('team_cancel_job', () => {
    test('cancels a planned/ready job', async () => {
      const planTool = findTool(tools, 'team_plan_jobs');
      const planned = parse(await planTool.invoke({
        jobs: [{title: 'Cancel me', description: 'Will cancel'}],
      }));

      const cancelTool = findTool(tools, 'team_cancel_job');
      const result = parse(await cancelTool.invoke({jobId: planned[0].id, reason: 'No longer needed'}));

      expect(result.cancelled).toBe(true);

      const board = registry.getJobBoard(team.teamId);
      expect(board.getJob(planned[0].id)!.status).toBe('failed');
    });
  });

  // ── team_get_jobboard ───────────────────────────────────────────

  describe('team_get_jobboard', () => {
    test('returns board state with jobs and progress', async () => {
      const planTool = findTool(tools, 'team_plan_jobs');
      await planTool.invoke({
        jobs: [{title: 'J1', description: 'D1'}, {title: 'J2', description: 'D2'}],
      });

      const boardTool = findTool(tools, 'team_get_jobboard');
      const result = parse(await boardTool.invoke({}));

      expect(result.jobs).toHaveLength(2);
      expect(result.progress.total).toBe(2);
    });
  });

  // ── team_spawn_member ───────────────────────────────────────────

  describe('team_spawn_member', () => {
    test('creates a member record', async () => {
      const spawnTool = findTool(tools, 'team_spawn_member');
      const result = parse(await spawnTool.invoke({name: 'worker-1', role: 'worker'}));

      expect(result.name).toBe('worker-1');
      expect(result.role).toBe('worker');
      expect(result.status).toBe('initializing');
      expect(result.mode).toBe('local');

      const members = registry.getMembersByTeam(team.teamId);
      expect(members).toHaveLength(2); // leader + worker
    });

    test('emits member.joined event', async () => {
      const spawnTool = findTool(tools, 'team_spawn_member');
      await spawnTool.invoke({name: 'worker-2', role: 'reviewer'});

      const joined = events.filter((e) => e.type === 'member.joined');
      expect(joined).toHaveLength(1);
      expect(joined[0].data).toMatchObject({name: 'worker-2', role: 'reviewer', mode: 'local'});
    });

    test('returns error when limit reached', async () => {
      // Fill up to maxMembers (default 10)
      for (let i = 0; i < 9; i++) {
        registry.registerMember(team.teamId, makeMember({
          memberId: `filler-${i}`,
          teamId: team.teamId,
        }));
      }

      const spawnTool = findTool(tools, 'team_spawn_member');
      const result = parse(await spawnTool.invoke({name: 'overflow', role: 'worker'}));

      expect(result.error).toBeDefined();
    });
  });

  // ── team_assign_job ─────────────────────────────────────────────

  describe('team_assign_job', () => {
    test('assigns a ready job to a member', async () => {
      // Create a worker
      const worker = makeMember({memberId: 'w-1', teamId: team.teamId, role: 'worker'});
      registry.registerMember(team.teamId, worker);
      transport.registerMember('w-1');

      // Plan a job
      const planTool = findTool(tools, 'team_plan_jobs');
      const planned = parse(await planTool.invoke({
        jobs: [{title: 'Assign me', description: 'Will be assigned'}],
      }));

      const assignTool = findTool(tools, 'team_assign_job');
      const result = parse(await assignTool.invoke({jobId: planned[0].id, memberId: 'w-1'}));

      expect(result.assigned).toBe(true);

      // Check job status
      const board = registry.getJobBoard(team.teamId);
      const job = board.getJob(planned[0].id)!;
      expect(job.status).toBe('in_progress');
      expect(job.assignee).toBe('w-1');

      // Check event
      const claimed = events.filter((e) => e.type === 'job.claimed');
      expect(claimed).toHaveLength(1);

      // Check message delivered
      const msgs = await transport.receive('w-1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('job_assigned');
    });

    test('returns error when job is not ready', async () => {
      const assignTool = findTool(tools, 'team_assign_job');
      const result = parse(await assignTool.invoke({jobId: 'nonexistent', memberId: 'w-1'}));
      expect(result.error).toBeDefined();
    });
  });

  // ── team_review_job ─────────────────────────────────────────────

  describe('team_review_job', () => {
    let jobId: string;

    beforeEach(async () => {
      // Set up: create worker, plan job, assign, submit
      const worker = makeMember({memberId: 'w-rev', teamId: team.teamId, role: 'worker'});
      registry.registerMember(team.teamId, worker);
      transport.registerMember('w-rev');

      const planTool = findTool(tools, 'team_plan_jobs');
      const planned = parse(await planTool.invoke({
        jobs: [{title: 'Review me', description: 'Will be reviewed'}],
      }));
      jobId = planned[0].id;

      const board = registry.getJobBoard(team.teamId);
      board.claimJob(jobId, 'w-rev');
      board.submitJob(jobId, {summary: 'Done', artifacts: []});

      // Clear events from setup
      events.length = 0;
    });

    test('approve path completes the job', async () => {
      const reviewTool = findTool(tools, 'team_review_job');
      const result = parse(await reviewTool.invoke({jobId, approved: true, feedback: 'Great work'}));

      expect(result.approved).toBe(true);

      const board = registry.getJobBoard(team.teamId);
      expect(board.getJob(jobId)!.status).toBe('done');

      const doneEvents = events.filter((e) => e.type === 'job.done');
      expect(doneEvents).toHaveLength(1);

      const msgs = await transport.receive('w-rev');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('job_reviewed');
    });

    test('reject path sends back for rework', async () => {
      const reviewTool = findTool(tools, 'team_review_job');
      const result = parse(await reviewTool.invoke({jobId, approved: false, feedback: 'Needs fixes'}));

      expect(result.approved).toBe(false);

      const board = registry.getJobBoard(team.teamId);
      expect(board.getJob(jobId)!.status).toBe('in_progress');

      const reviewed = events.filter((e) => e.type === 'job.reviewed');
      expect(reviewed).toHaveLength(1);
      expect((reviewed[0].data as any).approved).toBe(false);

      const msgs = await transport.receive('w-rev');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Needs fixes');
    });
  });

  // ── team_send_message ───────────────────────────────────────────

  describe('team_send_message', () => {
    test('sends a message to a member', async () => {
      const worker = makeMember({memberId: 'w-msg', teamId: team.teamId, role: 'worker'});
      registry.registerMember(team.teamId, worker);
      transport.registerMember('w-msg');

      const sendTool = findTool(tools, 'team_send_message');
      const result = parse(await sendTool.invoke({to: 'w-msg', content: 'Hello worker'}));

      expect(result.sent).toBe(true);

      const msgs = await transport.receive('w-msg');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Hello worker');
      expect(msgs[0].type).toBe('message');

      const msgEvents = events.filter((e) => e.type === 'team.message');
      expect(msgEvents).toHaveLength(1);
    });
  });

  // ── team_broadcast ──────────────────────────────────────────────

  describe('team_broadcast', () => {
    test('broadcasts to all members', async () => {
      const w1 = makeMember({memberId: 'bc-1', teamId: team.teamId, role: 'worker'});
      const w2 = makeMember({memberId: 'bc-2', teamId: team.teamId, role: 'worker'});
      registry.registerMember(team.teamId, w1);
      registry.registerMember(team.teamId, w2);
      transport.registerMember('bc-1');
      transport.registerMember('bc-2');

      const broadcastTool = findTool(tools, 'team_broadcast');
      const result = parse(await broadcastTool.invoke({content: 'Team update!'}));

      expect(result.broadcast).toBe(true);

      const msgs1 = await transport.receive('bc-1');
      const msgs2 = await transport.receive('bc-2');
      expect(msgs1).toHaveLength(1);
      expect(msgs2).toHaveLength(1);
      expect(msgs1[0].content).toBe('Team update!');
    });
  });

  // ── team_report ─────────────────────────────────────────────────

  describe('team_report', () => {
    test('isFinal emits team.completing event', async () => {
      const reportTool = findTool(tools, 'team_report');
      const result = parse(await reportTool.invoke({content: 'All done', isFinal: true}));

      expect(result.reported).toBe(true);
      expect(result.isFinal).toBe(true);

      const completing = events.filter((e) => e.type === 'team.completing');
      expect(completing).toHaveLength(1);
    });

    test('non-final report does not emit completing', async () => {
      const reportTool = findTool(tools, 'team_report');
      await reportTool.invoke({content: 'Progress 50%', isFinal: false});

      const completing = events.filter((e) => e.type === 'team.completing');
      expect(completing).toHaveLength(0);
    });
  });

  // ── team_shutdown ───────────────────────────────────────────────

  describe('team_shutdown', () => {
    test('emits completing event and updates status', async () => {
      // Need team in 'running' state for the transition
      registry.updateTeamStatus(team.teamId, 'spawning');
      registry.updateTeamStatus(team.teamId, 'running');

      const shutdownTool = findTool(tools, 'team_shutdown');
      const result = parse(await shutdownTool.invoke({reason: 'Done'}));

      expect(result.shutdown).toBe(true);

      const completing = events.filter((e) => e.type === 'team.completing');
      expect(completing).toHaveLength(1);

      expect(registry.getTeam(team.teamId)!.status).toBe('completing');
    });
  });

  // ── team_connect_remote ─────────────────────────────────────────

  describe('team_connect_remote', () => {
    test('returns stub message', async () => {
      const remoteTool = findTool(tools, 'team_connect_remote');
      const result = parse(await remoteTool.invoke({remoteName: 'ext-agent', role: 'worker'}));

      expect(result.status).toBe('not_implemented');
    });
  });

  // ── team_update_job ─────────────────────────────────────────────

  describe('team_update_job', () => {
    test('updates job fields', async () => {
      const planTool = findTool(tools, 'team_plan_jobs');
      const planned = parse(await planTool.invoke({
        jobs: [{title: 'Update me', description: 'Original'}],
      }));

      const updateTool = findTool(tools, 'team_update_job');
      const result = parse(await updateTool.invoke({
        jobId: planned[0].id,
        description: 'Updated desc',
        priority: 5,
      }));

      expect(result.description).toBe('Updated desc');
      expect(result.priority).toBe(5);
    });
  });

  // ── team_create_subteam ─────────────────────────────────────────

  describe('team_create_subteam', () => {
    test('creates a sub-team', async () => {
      const subteamTool = findTool(tools, 'team_create_subteam');
      const result = parse(await subteamTool.invoke({name: 'sub-alpha', goal: 'Handle frontend'}));

      expect(result.name).toBe('sub-alpha');
      expect(result.parentTeamId).toBe(team.teamId);
      expect(result.depth).toBe(1);

      const created = events.filter((e) => e.type === 'team.created');
      expect(created).toHaveLength(1);
    });
  });
});

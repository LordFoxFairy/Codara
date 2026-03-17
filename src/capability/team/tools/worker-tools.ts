import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TeamMessage} from '@capability/team/types';
import type {TeamToolContext} from './types';

// ─── team_claim_job ─────────────────────────────────────────────────

function buildClaimJob(ctx: TeamToolContext) {
  return tool(
    async ({jobId}) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const claimed = board.claimJob(jobId, ctx.memberId);

      if (!claimed) {
        return JSON.stringify({success: false, error: 'Job is not claimable (not ready, already assigned, or worker busy)'});
      }

      ctx.registry.updateMember(ctx.teamId, ctx.memberId, {
        currentJobId: jobId,
        status: 'working',
      });

      ctx.emitEvent({
        type: 'job.claimed',
        data: {teamId: ctx.teamId, jobId, memberId: ctx.memberId},
      });
      ctx.emitEvent({
        type: 'member.working',
        data: {teamId: ctx.teamId, memberId: ctx.memberId, jobId},
      });

      const job = board.getJob(jobId)!;
      return JSON.stringify({
        success: true,
        job: {id: job.id, title: job.title, description: job.description, priority: job.priority},
      });
    },
    {
      name: 'team_claim_job',
      description: 'Claim a ready job from the team job board to work on it.',
      schema: z.object({jobId: z.string()}),
    },
  );
}

// ─── team_submit_job ────────────────────────────────────────────────

function buildSubmitJob(ctx: TeamToolContext) {
  return tool(
    async ({jobId, summary, artifacts}) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);

      board.submitJob(jobId, {
        summary,
        artifacts: artifacts ?? [],
      });

      ctx.registry.updateMember(ctx.teamId, ctx.memberId, {
        currentJobId: undefined,
        status: 'idle',
      });

      // Notify leader
      const leader = ctx.registry.getLeader(ctx.teamId);
      if (leader) {
        const msg: TeamMessage = {
          id: crypto.randomUUID(),
          from: ctx.memberId,
          to: leader.memberId,
          teamId: ctx.teamId,
          type: 'job_submitted',
          content: summary,
          metadata: {jobId, artifacts},
          timestamp: new Date().toISOString(),
          read: false,
        };
        await ctx.transport.send(leader.memberId, msg);
      }

      ctx.emitEvent({
        type: 'job.submitted',
        data: {teamId: ctx.teamId, jobId, memberId: ctx.memberId},
      });

      return JSON.stringify({success: true, jobId, status: 'submitted'});
    },
    {
      name: 'team_submit_job',
      description: 'Submit a completed job with a summary and optional artifacts for review.',
      schema: z.object({
        jobId: z.string(),
        summary: z.string(),
        artifacts: z.array(z.object({
          type: z.enum(['diff', 'file', 'test_report', 'log']),
          content: z.string(),
          path: z.string().optional(),
        })).optional(),
      }),
    },
  );
}

// ─── team_send_message ──────────────────────────────────────────────

function buildSendMessage(ctx: TeamToolContext) {
  return tool(
    async ({to, content}) => {
      const msg: TeamMessage = {
        id: crypto.randomUUID(),
        from: ctx.memberId,
        to,
        teamId: ctx.teamId,
        type: 'message',
        content,
        timestamp: new Date().toISOString(),
        read: false,
      };
      await ctx.transport.send(to, msg);
      return JSON.stringify({success: true, messageId: msg.id});
    },
    {
      name: 'team_send_message',
      description: 'Send a message to another team member.',
      schema: z.object({to: z.string(), content: z.string()}),
    },
  );
}

// ─── team_ask_leader ────────────────────────────────────────────────

function buildAskLeader(ctx: TeamToolContext) {
  return tool(
    async ({question}) => {
      const leader = ctx.registry.getLeader(ctx.teamId);
      if (!leader) {
        return JSON.stringify({success: false, error: 'No leader found for this team'});
      }

      const msg: TeamMessage = {
        id: crypto.randomUUID(),
        from: ctx.memberId,
        to: leader.memberId,
        teamId: ctx.teamId,
        type: 'question',
        content: question,
        timestamp: new Date().toISOString(),
        read: false,
      };
      await ctx.transport.send(leader.memberId, msg);

      return JSON.stringify({success: true, messageId: msg.id, leaderId: leader.memberId});
    },
    {
      name: 'team_ask_leader',
      description: 'Send a question to the team leader for guidance or clarification.',
      schema: z.object({question: z.string()}),
    },
  );
}

// ─── team_list_jobs ─────────────────────────────────────────────────

function buildListJobs(ctx: TeamToolContext) {
  return tool(
    async () => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const claimable = board.getClaimable(ctx.memberId);
      const allJobs = board.getAllJobs();
      const progress = board.getProgress();
      return JSON.stringify({
        progress,
        claimable: claimable.map(j => ({
          id: j.id,
          title: j.title,
          description: j.description,
          priority: j.priority,
        })),
        all: allJobs.map(j => ({
          id: j.id,
          title: j.title,
          status: j.status,
          assignee: j.assignee,
        })),
      });
    },
    {
      name: 'team_list_jobs',
      description: 'List all jobs on the team job board. Shows claimable jobs (ready for you to work on) and overall progress.',
      schema: z.object({}),
    },
  );
}

// ─── Export ─────────────────────────────────────────────────────────

export function createWorkerTools(ctx: TeamToolContext): StructuredToolInterface[] {
  return [
    buildListJobs(ctx),
    buildClaimJob(ctx),
    buildSubmitJob(ctx),
    buildSendMessage(ctx),
    buildAskLeader(ctx),
  ];
}

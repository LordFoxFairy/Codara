import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TeamMessage} from '@capability/team/types';
import type {TeamToolContext} from './types';

// ─── team_review_submit ─────────────────────────────────────────────

function buildReviewSubmit(ctx: TeamToolContext) {
  return tool(
    async ({jobId, approved, comments, severity}) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const job = board.getJob(jobId);

      if (!job) {
        return JSON.stringify({success: false, error: `Job not found: ${jobId}`});
      }

      if (approved) {
        board.completeJob(jobId, ctx.memberId);

        ctx.emitter.emit({
          type: 'job.done',
          data: {teamId: ctx.teamId, jobId},
        });
      } else {
        board.rejectJob(jobId, comments);

        ctx.emitter.emit({
          type: 'job.reviewed',
          data: {teamId: ctx.teamId, jobId, approved: false, reviewerId: ctx.memberId},
        });
      }

      // Send feedback to assignee
      if (job.assignee) {
        const msg: TeamMessage = {
          id: crypto.randomUUID(),
          from: ctx.memberId,
          to: job.assignee,
          teamId: ctx.teamId,
          type: 'job_reviewed',
          content: comments,
          metadata: {jobId, approved, severity},
          timestamp: new Date().toISOString(),
          read: false,
        };
        await ctx.transport.send(job.assignee, msg);
      }

      return JSON.stringify({
        success: true,
        jobId,
        approved,
        status: approved ? 'done' : 'rejected',
      });
    },
    {
      name: 'team_review_submit',
      description: 'Submit a review for a job — approve to complete it, or reject with feedback.',
      schema: z.object({
        jobId: z.string(),
        approved: z.boolean(),
        comments: z.string(),
        severity: z.enum(['critical', 'suggestion']).optional(),
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

// ─── Export ─────────────────────────────────────────────────────────

export function createReviewerTools(ctx: TeamToolContext): StructuredToolInterface[] {
  return [
    buildReviewSubmit(ctx),
    buildSendMessage(ctx),
  ];
}

import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {Team, TeamMessage} from '@capability/team/types';
import {SECURITY_DEFAULTS} from '@capability/team/types';
import {mergeBranch} from '@capability/team/worktree/merge-coordinator';
import type {TeamToolContext} from './types';

// ─── Inline security guards (depth-control.ts removed) ──────────────

function canCreateSubTeam(team: Team): boolean {
  return team.config.allowSubTeams && team.depth < team.config.maxDepth;
}

function canSpawnMember(
  teamMemberCount: number,
  teamMaxMembers: number,
  globalAgentCount: number,
): boolean {
  return teamMemberCount < teamMaxMembers
    && globalAgentCount < SECURITY_DEFAULTS.maxTotalAgents;
}

// ─── Factory ────────────────────────────────────────────────────────

export function createLeaderTools(ctx: TeamToolContext): StructuredToolInterface[] {
  return [
    createTeamPlanJobsTool(ctx),
    createTeamUpdateJobTool(ctx),
    createTeamCancelJobTool(ctx),
    createTeamGetJobBoardTool(ctx),
    createTeamSpawnMemberTool(ctx),
    createTeamAssignJobTool(ctx),
    createTeamReviewJobTool(ctx),
    createTeamMergeBranchTool(ctx),
    createTeamSendMessageTool(ctx),
    createTeamBroadcastTool(ctx),
    createTeamCreateSubteamTool(ctx),
    createTeamReportTool(ctx),
    createTeamShutdownTool(ctx),
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────

function makeMessage(
  ctx: TeamToolContext,
  to: string | 'broadcast',
  type: TeamMessage['type'],
  content: string,
  metadata?: Record<string, unknown>,
): TeamMessage {
  return {
    id: `msg_${crypto.randomUUID().slice(0, 8)}`,
    from: ctx.memberId,
    to,
    teamId: ctx.teamId,
    type,
    content,
    metadata,
    timestamp: new Date().toISOString(),
    read: false,
  };
}

// ─── 1. team_plan_jobs ──────────────────────────────────────────────

function createTeamPlanJobsTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const created = board.planJobs(input.jobs);

      for (const job of created) {
        ctx.emitEvent({
          type: 'job.created',
          data: {teamId: ctx.teamId, jobId: job.id, title: job.title, priority: job.priority},
        });
      }

      return JSON.stringify(created);
    },
    {
      name: 'team_plan_jobs',
      description: 'Plan multiple jobs on the team job board. Supports dependency chains via blockedBy.',
      schema: z.object({
        jobs: z.array(z.object({
          title: z.string(),
          description: z.string(),
          priority: z.number().default(0),
          blockedBy: z.array(z.string()).optional(),
        })),
      }),
    },
  );
}

// ─── 2. team_update_job ─────────────────────────────────────────────

function createTeamUpdateJobTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const job = board.getJob(input.jobId);
      if (!job) return JSON.stringify({error: `Job not found: ${input.jobId}`});

      if (input.description !== undefined) job.description = input.description;
      if (input.priority !== undefined) job.priority = input.priority;
      if (input.addBlockedBy) {
        for (const dep of input.addBlockedBy) {
          if (!job.blockedBy.includes(dep)) job.blockedBy.push(dep);
        }
      }
      if (input.removeBlockedBy) {
        job.blockedBy = job.blockedBy.filter((id) => !input.removeBlockedBy!.includes(id));
      }

      return JSON.stringify(job);
    },
    {
      name: 'team_update_job',
      description: 'Update a job\'s description, priority, or dependency list.',
      schema: z.object({
        jobId: z.string(),
        description: z.string().optional(),
        priority: z.number().optional(),
        addBlockedBy: z.array(z.string()).optional(),
        removeBlockedBy: z.array(z.string()).optional(),
      }),
    },
  );
}

// ─── 3. team_cancel_job ─────────────────────────────────────────────

function createTeamCancelJobTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      board.cancelJob(input.jobId, input.reason);
      return JSON.stringify({cancelled: true, jobId: input.jobId});
    },
    {
      name: 'team_cancel_job',
      description: 'Cancel a planned or ready job.',
      schema: z.object({
        jobId: z.string(),
        reason: z.string(),
      }),
    },
  );
}

// ─── 4. team_get_jobboard ───────────────────────────────────────────

function createTeamGetJobBoardTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async () => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      return JSON.stringify({
        jobs: board.getAllJobs(),
        progress: board.getProgress(),
      });
    },
    {
      name: 'team_get_jobboard',
      description: 'Get the current state of the team job board, including all jobs and progress summary.',
      schema: z.object({}),
    },
  );
}

// ─── 5. team_spawn_member ───────────────────────────────────────────

function createTeamSpawnMemberTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const team = ctx.registry.getTeam(ctx.teamId);
      if (!team) return JSON.stringify({error: `Team not found: ${ctx.teamId}`});

      const currentMembers = ctx.registry.getMembersByTeam(ctx.teamId);
      const globalCount = ctx.registry.getTotalAgentCount();

      if (!canSpawnMember(currentMembers.length, team.config.maxMembers, globalCount)) {
        return JSON.stringify({error: 'Cannot spawn member: team or global agent limit reached'});
      }

      const memberId = `member_${crypto.randomUUID().slice(0, 8)}`;
      const member = {
        memberId,
        name: input.name,
        teamId: ctx.teamId,
        role: input.role as 'worker',
        status: 'initializing' as const,
        model: input.model,
        sessionId: `session_${memberId}`,
        mode: 'local' as const,
        joinedAt: new Date().toISOString(),
      };

      ctx.registry.registerMember(ctx.teamId, member);

      ctx.emitEvent({
        type: 'member.joined',
        data: {teamId: ctx.teamId, memberId, name: input.name, role: input.role, mode: 'local'},
      });

      return JSON.stringify(member);
    },
    {
      name: 'team_spawn_member',
      description: 'Spawn a new local team member (worker). Creates the member record; the runtime handles actual agent session creation.',
      schema: z.object({
        name: z.string(),
        role: z.enum(['worker']),
        model: z.string().optional(),
      }),
    },
  );
}

// ─── 7. team_assign_job ─────────────────────────────────────────────

function createTeamAssignJobTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);

      let claimed: boolean;
      try {
        claimed = board.claimJob(input.jobId, input.memberId);
      } catch (err: any) {
        return JSON.stringify({error: err.message});
      }

      if (!claimed) {
        return JSON.stringify({error: `Cannot assign job ${input.jobId} to ${input.memberId}. Job may not be ready or member may already have an active job.`});
      }

      ctx.emitEvent({
        type: 'job.claimed',
        data: {teamId: ctx.teamId, jobId: input.jobId, memberId: input.memberId},
      });

      const msg = makeMessage(ctx, input.memberId, 'job_assigned', `You have been assigned job: ${input.jobId}`, {jobId: input.jobId});
      await ctx.transport.send(input.memberId, msg);

      return JSON.stringify({assigned: true, jobId: input.jobId, memberId: input.memberId});
    },
    {
      name: 'team_assign_job',
      description: 'Assign a ready job to a specific team member.',
      schema: z.object({
        jobId: z.string(),
        memberId: z.string(),
      }),
    },
  );
}

// ─── 8. team_review_job ─────────────────────────────────────────────

function createTeamReviewJobTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const board = ctx.registry.getJobBoard(ctx.teamId);
      const job = board.getJob(input.jobId);
      if (!job) return JSON.stringify({error: `Job not found: ${input.jobId}`});

      if (input.approved) {
        board.completeJob(input.jobId, ctx.memberId);
        ctx.emitEvent({
          type: 'job.done',
          data: {teamId: ctx.teamId, jobId: input.jobId},
        });

        if (job.assignee) {
          const msg = makeMessage(ctx, job.assignee, 'job_reviewed', input.feedback ?? 'Job approved.', {jobId: input.jobId, approved: true});
          await ctx.transport.send(job.assignee, msg);
        }

        return JSON.stringify({reviewed: true, approved: true, jobId: input.jobId});
      } else {
        board.rejectJob(input.jobId, input.feedback ?? 'Rejected');
        ctx.emitEvent({
          type: 'job.reviewed',
          data: {teamId: ctx.teamId, jobId: input.jobId, approved: false, reviewerId: ctx.memberId},
        });

        if (job.assignee) {
          const msg = makeMessage(ctx, job.assignee, 'job_reviewed', input.feedback ?? 'Job rejected.', {jobId: input.jobId, approved: false});
          await ctx.transport.send(job.assignee, msg);
        }

        return JSON.stringify({reviewed: true, approved: false, jobId: input.jobId});
      }
    },
    {
      name: 'team_review_job',
      description: 'Review a submitted job — approve to complete it, or reject to send it back for rework.',
      schema: z.object({
        jobId: z.string(),
        approved: z.boolean(),
        feedback: z.string().optional(),
      }),
    },
  );
}

// ─── 9. team_merge_branch ───────────────────────────────────────────

function createTeamMergeBranchTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const leader = ctx.registry.getMember(ctx.memberId);
      const targetBranch = leader?.worktreePath ?? 'main';
      const result = await mergeBranch(input.sourceBranch, targetBranch, ctx.projectRoot, input.message);
      return JSON.stringify(result);
    },
    {
      name: 'team_merge_branch',
      description: 'Merge a source branch into the leader\'s branch.',
      schema: z.object({
        sourceBranch: z.string(),
        message: z.string().optional(),
      }),
    },
  );
}

// ─── 10. team_send_message ──────────────────────────────────────────

function createTeamSendMessageTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const msg = makeMessage(ctx, input.to, 'message', input.content);
      await ctx.transport.send(input.to, msg);

      ctx.emitEvent({
        type: 'team.message',
        data: {teamId: ctx.teamId, message: msg},
      });

      return JSON.stringify({sent: true, messageId: msg.id});
    },
    {
      name: 'team_send_message',
      description: 'Send a direct message to a specific team member.',
      schema: z.object({
        to: z.string(),
        content: z.string(),
      }),
    },
  );
}

// ─── 11. team_broadcast ─────────────────────────────────────────────

function createTeamBroadcastTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const msg = makeMessage(ctx, 'broadcast', 'message', input.content);
      await ctx.transport.send('broadcast', msg);

      ctx.emitEvent({
        type: 'team.message',
        data: {teamId: ctx.teamId, message: msg},
      });

      return JSON.stringify({broadcast: true, messageId: msg.id});
    },
    {
      name: 'team_broadcast',
      description: 'Broadcast a message to all team members.',
      schema: z.object({
        content: z.string(),
      }),
    },
  );
}

// ─── 12. team_create_subteam ────────────────────────────────────────

function createTeamCreateSubteamTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const team = ctx.registry.getTeam(ctx.teamId);
      if (!team) return JSON.stringify({error: `Team not found: ${ctx.teamId}`});

      if (!canCreateSubTeam(team)) {
        return JSON.stringify({error: 'Cannot create sub-team: depth limit reached or sub-teams disabled'});
      }

      const subTeam = ctx.registry.createSubTeam(ctx.teamId, {
        name: input.name,
        goal: input.goal,
        config: input.config as Record<string, unknown> | undefined,
        createdBy: ctx.memberId,
      });

      ctx.emitEvent({
        type: 'team.created',
        data: {teamId: subTeam.teamId, name: subTeam.name, goal: subTeam.goal, depth: subTeam.depth},
      });

      return JSON.stringify(subTeam);
    },
    {
      name: 'team_create_subteam',
      description: 'Create a sub-team under the current team.',
      schema: z.object({
        name: z.string(),
        goal: z.string(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    },
  );
}

// ─── 13. team_report ────────────────────────────────────────────────

function createTeamReportTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      const msg = makeMessage(ctx, 'user', 'status_update', input.content, {isFinal: input.isFinal});
      await ctx.transport.send('user', msg).catch(() => {
        // 'user' may not be a registered transport member — that's OK
      });

      if (input.isFinal) {
        ctx.emitEvent({
          type: 'team.completing',
          data: {teamId: ctx.teamId},
        });
      }

      return JSON.stringify({reported: true, isFinal: input.isFinal});
    },
    {
      name: 'team_report',
      description: 'Send a progress report to the user. Set isFinal=true for the final report.',
      schema: z.object({
        content: z.string(),
        isFinal: z.boolean().default(false),
      }),
    },
  );
}

// ─── 14. team_shutdown ──────────────────────────────────────────────

function createTeamShutdownTool(ctx: TeamToolContext): StructuredToolInterface {
  return tool(
    async (input) => {
      ctx.emitEvent({
        type: 'team.completing',
        data: {teamId: ctx.teamId},
      });

      // Transition team to 'completing' — requires 'running' state
      try {
        ctx.registry.updateTeamStatus(ctx.teamId, 'completing');
      } catch {
        // Team may already be in completing or other transitional state
      }

      return JSON.stringify({shutdown: true, reason: input.reason ?? 'Leader initiated shutdown'});
    },
    {
      name: 'team_shutdown',
      description: 'Initiate team shutdown. Actual cleanup is handled by TeamRuntime.',
      schema: z.object({
        reason: z.string().optional(),
      }),
    },
  );
}

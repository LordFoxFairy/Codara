import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TeamRegistry} from '@capability/team/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {SharedState} from '@capability/team/state/shared-state';

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Conversation-driven team tools for the main Codara agent.
 *
 * The main agent acts as the team leader (like Claude Code):
 * - create_team: set up a team
 * - spawn_teammate: add a worker to the team
 * - send_message: communicate with a teammate
 * - list_teams / team_status: monitor progress
 * - shutdown_team: finish a team
 */
export function createConversationTeamTools(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
  sharedState: SharedState;
}): StructuredToolInterface[] {
  return [
    createTeamTool(deps),
    spawnTeammateTool(deps),
    sendMessageTool(deps),
    listTeamsTool(deps),
    teamStatusTool(deps),
    planJobsTool(deps),
    assignJobTool(deps),
    reviewJobTool(deps),
    shutdownTeamTool(deps),
  ];
}

// ─── Tools ──────────────────────────────────────────────────────────

function createTeamTool(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
  sharedState: SharedState;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const name = input.name ?? `team-${Date.now().toString(36)}`;
        const team = deps.registry.createTeam({name, goal: input.goal});
        await deps.runtime.startTeam(team.teamId);
        deps.sharedState.updateTeamState(team.teamId, {
          status: 'running',
          jobsSummary: {total: 0, done: 0, failed: 0},
        });
        return JSON.stringify({teamId: team.teamId, name: team.name, status: 'running'});
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'create_team',
      description:
        'Create a new team to work on a complex goal. You (the main agent) are the team leader. After creating the team, use spawn_teammate to add workers.',
      schema: z.object({
        goal: z.string().describe('The goal for the team'),
        name: z.string().optional().describe('Optional team name'),
      }),
    },
  );
}

function spawnTeammateTool(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
        if (!team) return JSON.stringify({error: `Team "${input.teamId}" not found`});
        const member = await deps.runtime.spawnMember(
          team.teamId,
          input.name,
          'worker',
          input.model,
        );
        return JSON.stringify({
          memberId: member.memberId,
          name: member.name,
          role: member.role,
          status: 'spawned',
        });
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'spawn_teammate',
      description:
        'Spawn a new teammate (worker) in a team. The worker runs independently in its own session. Give it a descriptive name based on what it will work on.',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
        name: z.string().describe('Descriptive name for the teammate, e.g. "backend-api" or "test-writer"'),
        model: z.string().optional().describe('Model to use for this teammate (defaults to same as parent)'),
      }),
    },
  );
}

function sendMessageTool(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
        if (!team) return JSON.stringify({error: `Team "${input.teamId}" not found`});
        const transport = deps.runtime.getTransport(team.teamId);
        if (!transport) return JSON.stringify({error: `Team "${team.name}" transport not available`});
        const to = input.memberId ?? 'broadcast';
        await transport.send(to, {
          id: `msg_${crypto.randomUUID().slice(0, 8)}`,
          from: 'leader',
          to,
          teamId: team.teamId,
          type: 'message',
          content: input.message,
          timestamp: new Date().toISOString(),
          read: false,
        });
        return JSON.stringify({ok: true, sentTo: to});
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'send_message',
      description:
        'Send a message to a teammate or broadcast to the entire team. Use to give instructions, ask for status, or coordinate work.',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
        message: z.string().describe('The message content'),
        memberId: z.string().optional().describe('Specific member ID to message (omit for broadcast to all)'),
      }),
    },
  );
}

function listTeamsTool(deps: {
  registry: TeamRegistry;
}): StructuredToolInterface {
  return tool(
    async () => {
      const teams = deps.registry.listTeams();
      return JSON.stringify(
        teams.map((t) => ({
          id: t.teamId,
          name: t.name,
          status: t.status,
          goal: t.goal,
        })),
      );
    },
    {
      name: 'list_teams',
      description: 'List all active teams and their status',
      schema: z.object({}),
    },
  );
}

function teamStatusTool(deps: {
  registry: TeamRegistry;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
      if (!team) return JSON.stringify({error: 'Team not found'});
      const members = deps.registry.getMembersByTeam(team.teamId);
      const jobBoard = deps.registry.getJobBoard(team.teamId);
      const jobs = jobBoard.getAllJobs();
      return JSON.stringify({
        team: {id: team.teamId, name: team.name, status: team.status, goal: team.goal},
        members: members.map((m) => ({
          id: m.memberId,
          name: m.name,
          role: m.role,
          status: m.status,
        })),
        jobs: jobs.map((j) => ({
          id: j.id,
          title: j.title,
          status: j.status,
          assignee: j.assignee,
        })),
      });
    },
    {
      name: 'team_status',
      description: 'Get detailed status of a team including members and jobs',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
      }),
    },
  );
}

function planJobsTool(deps: {
  registry: TeamRegistry;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
        if (!team) return JSON.stringify({error: `Team "${input.teamId}" not found`});
        const board = deps.registry.getJobBoard(team.teamId);
        const created = board.planJobs(input.jobs);
        return JSON.stringify({
          planned: created.length,
          jobs: created.map((j) => ({id: j.id, title: j.title, status: j.status})),
        });
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'plan_jobs',
      description:
        'Plan work items on the team job board. Each job can have dependencies (blockedBy) to create execution order. Workers claim and work on jobs independently.',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
        jobs: z.array(z.object({
          title: z.string().describe('Short title for the job'),
          description: z.string().describe('Detailed description of what needs to be done'),
          priority: z.number().default(0).describe('Higher = more important'),
          blockedBy: z.array(z.string()).optional().describe('Job IDs that must complete before this one'),
        })).describe('Jobs to plan'),
      }),
    },
  );
}

function assignJobTool(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
        if (!team) return JSON.stringify({error: `Team "${input.teamId}" not found`});
        const board = deps.registry.getJobBoard(team.teamId);
        const claimed = board.claimJob(input.jobId, input.memberId);
        if (!claimed) {
          return JSON.stringify({error: `Cannot assign job ${input.jobId} — not ready or member already busy`});
        }
        deps.registry.updateMember(team.teamId, input.memberId, {
          currentJobId: input.jobId,
          status: 'working',
        });
        // Notify the member via transport
        const transport = deps.runtime.getTransport(team.teamId);
        if (transport) {
          await transport.send(input.memberId, {
            id: `msg_${crypto.randomUUID().slice(0, 8)}`,
            from: 'leader',
            to: input.memberId,
            teamId: team.teamId,
            type: 'job_assigned',
            content: `You have been assigned job: ${input.jobId}`,
            metadata: {jobId: input.jobId},
            timestamp: new Date().toISOString(),
            read: false,
          });
        }
        return JSON.stringify({assigned: true, jobId: input.jobId, memberId: input.memberId});
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'assign_job',
      description:
        'Assign a ready job to a specific team member. The member will be notified and start working on it.',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
        jobId: z.string().describe('The job ID to assign'),
        memberId: z.string().describe('The member ID to assign the job to'),
      }),
    },
  );
}

function reviewJobTool(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const team = deps.registry.getTeam(input.teamId) ?? deps.registry.getTeamByName(input.teamId);
        if (!team) return JSON.stringify({error: `Team "${input.teamId}" not found`});
        const board = deps.registry.getJobBoard(team.teamId);
        const job = board.getJob(input.jobId);
        if (!job) return JSON.stringify({error: `Job ${input.jobId} not found`});

        if (input.approved) {
          board.completeJob(input.jobId, 'leader');
          // Notify assignee
          if (job.assignee) {
            const transport = deps.runtime.getTransport(team.teamId);
            if (transport) {
              await transport.send(job.assignee, {
                id: `msg_${crypto.randomUUID().slice(0, 8)}`,
                from: 'leader',
                to: job.assignee,
                teamId: team.teamId,
                type: 'job_reviewed',
                content: input.feedback ?? 'Job approved.',
                metadata: {jobId: input.jobId, approved: true},
                timestamp: new Date().toISOString(),
                read: false,
              });
            }
          }
          return JSON.stringify({reviewed: true, approved: true, jobId: input.jobId});
        } else {
          board.rejectJob(input.jobId, input.feedback ?? 'Rejected');
          if (job.assignee) {
            const transport = deps.runtime.getTransport(team.teamId);
            if (transport) {
              await transport.send(job.assignee, {
                id: `msg_${crypto.randomUUID().slice(0, 8)}`,
                from: 'leader',
                to: job.assignee,
                teamId: team.teamId,
                type: 'job_reviewed',
                content: input.feedback ?? 'Job rejected — rework needed.',
                metadata: {jobId: input.jobId, approved: false},
                timestamp: new Date().toISOString(),
                read: false,
              });
            }
          }
          return JSON.stringify({reviewed: true, approved: false, jobId: input.jobId});
        }
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'review_job',
      description:
        'Review a submitted job — approve to complete it, or reject to send it back for rework.',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
        jobId: z.string().describe('The job ID to review'),
        approved: z.boolean().describe('Whether to approve or reject the job'),
        feedback: z.string().optional().describe('Feedback for the worker'),
      }),
    },
  );
}

function shutdownTeamTool(deps: {
  runtime: TeamRuntime;
  sharedState: SharedState;
}): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        await deps.runtime.shutdownTeam(input.teamId);
        deps.sharedState.removeTeamState(input.teamId);
        return JSON.stringify({ok: true});
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'shutdown_team',
      description: 'Gracefully shut down a team after work is complete',
      schema: z.object({
        teamId: z.string().describe('The team ID to shut down'),
      }),
    },
  );
}

import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {Command} from '@core/agent/models/command';
import type {TeamRegistry} from '@capability/team/coordination/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {SharedState} from '@capability/team/shared-state';
import type {TeamSurfaceState} from '@capability/team/middleware';

type ConversationDeps = {
  registry: TeamRegistry;
  runtime: TeamRuntime;
  sharedState: SharedState;
};

const configurableSchema = z.object({
  configurable: z.object({
    context: z.record(z.string(), z.unknown()).optional(),
    execution: z.object({
      sessionId: z.string().optional(),
    }).optional(),
  }).optional(),
}).loose();

export function createConversationTeamTools(deps: ConversationDeps): StructuredToolInterface[] {
  return createConversationTeamToolsWithMode(deps, {includeAdvanced: false});
}

export function createConversationTeamToolsWithMode(
  deps: ConversationDeps,
  options: {
    includeAdvanced?: boolean;
  } = {},
): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [
    spawnTeammateTool(deps),
    teamStatusTool(deps),
    planJobsTool(deps),
    assignJobTool(deps),
    reviewJobTool(deps),
    sendMessageTool(deps),
    shutdownTeamTool(deps),
  ];

  if (options.includeAdvanced) {
    tools.push(
      createTeamTool(deps),
      createEnterTeamTool(deps),
      createLeaveTeamTool(),
      listTeamsTool(deps),
    );
  }

  return tools;
}

function createTeamTool(deps: ConversationDeps): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const activeTeamId = readActiveTeamId(config);
        if (activeTeamId) {
          const activeTeam = deps.registry.getTeam(activeTeamId) ?? deps.registry.getTeamByName(activeTeamId);
          if (activeTeam) {
            return [
              JSON.stringify({
                error: `Already leading team "${activeTeam.name}". Use spawn teammates inside the current team, or enter_team after leaving the current team if you truly need a separate team.`,
              }),
              undefined,
            ] as const;
          }
        }
        const name = input.name ?? `team-${Date.now().toString(36)}`;
        const team = deps.registry.createTeam({
          name,
          goal: input.goal,
          createdBy: readExecutionSessionId(config),
        });
        await deps.runtime.startTeam(team.teamId);
        deps.sharedState.updateTeamState(team.teamId, {
          status: 'running',
          jobsSummary: {total: 0, done: 0, failed: 0},
        });
        return [
          JSON.stringify({teamId: team.teamId, name: team.name, status: 'running'}),
          new Command({
            update: {
              context: {
                teamSurface: {
                  activeTeamId: team.teamId,
                  teamRole: 'leader',
                  teamMode: 'leader',
                } satisfies TeamSurfaceState,
              },
            },
          }),
        ] as const;
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'create_team',
      description: 'Advanced/manual: create a separate team and enter its leader context. Prefer spawn_teammate inside the current team for normal work.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        goal: z.string().describe('The goal for the team'),
        name: z.string().optional().describe('Optional team name'),
      }),
    },
  );
}

function createEnterTeamTool(deps: ConversationDeps): StructuredToolInterface {
  return tool(
    async ({teamId}) => {
      const team = deps.registry.getTeam(teamId) ?? deps.registry.getTeamByName(teamId);
      if (!team) {
        return JSON.stringify({error: `Team "${teamId}" not found`});
      }
      return [
        `Entered team "${team.name}" leader context.`,
        new Command({
          update: {
            context: {
              teamSurface: {
                activeTeamId: team.teamId,
                teamRole: 'leader',
                teamMode: 'leader',
              } satisfies TeamSurfaceState,
            },
          },
        }),
      ] as const;
    },
    {
      name: 'enter_team',
      description: 'Advanced/manual: switch leader focus into an existing team.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        teamId: z.string().describe('The team ID or name'),
      }),
    },
  );
}

function createLeaveTeamTool(): StructuredToolInterface {
  return tool(
    async () => [
      'Left team context.',
      new Command({
        update: {
          context: {
            teamSurface: {
              activeTeamId: undefined,
              teamRole: 'leader',
              teamMode: 'leader',
            },
          },
        },
      }),
    ] as const,
    {
      name: 'leave_team',
      description: 'Advanced/manual: leave the current team focus and return to the unfocused leader context.',
      responseFormat: 'content_and_artifact',
      schema: z.object({}),
    },
  );
}

function listTeamsTool(deps: Pick<ConversationDeps, 'registry'>): StructuredToolInterface {
  return tool(
    async () => JSON.stringify(
      deps.registry.listTeams().map((t) => ({
        id: t.teamId,
        name: t.name,
        status: t.status,
        goal: t.goal,
      })),
    ),
    {
      name: 'list_teams',
      description: 'Advanced/manual: list saved or active teams available for explicit switching or recovery.',
      schema: z.object({}),
    },
  );
}

function teamStatusTool(deps: Pick<ConversationDeps, 'registry'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      const target = resolveTargetTeam(deps.registry, input.teamId, config);
      if (target.error) return JSON.stringify({error: target.error});
      const team = target.team;
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
      description: 'Get the current team roster, jobs, and status. teamId is only needed for advanced manual inspection.',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
      }),
    },
  );
}

function spawnTeammateTool(deps: Pick<ConversationDeps, 'registry' | 'runtime'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const sessionId = readExecutionSessionId(config);
        const bootstrap = target.team
          ? undefined
          : await ensureLeaderTeam(deps.registry, deps.runtime, config, sessionId);
        if (bootstrap?.error) return JSON.stringify({error: bootstrap.error});
        const team = target.team ?? bootstrap?.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        ensureRunningTeam(deps.runtime, team.teamId, team.status);
        const member = await deps.runtime.spawnMember(team.teamId, input.name, 'worker', input.model);
        const payload = JSON.stringify({
          memberId: member.memberId,
          name: member.name,
          role: member.role,
          status: 'spawned',
        });
        if (!bootstrap) {
          return [payload, undefined] as const;
        }
        return [
          payload,
          new Command({
            update: {
              context: {
                teamSurface: {
                  activeTeamId: team.teamId,
                  teamRole: 'leader',
                  teamMode: 'leader',
                } satisfies TeamSurfaceState,
              },
            },
          }),
        ] as const;
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'spawn_teammate',
      description: 'Default team staffing entrypoint. Spawn a worker in the current team, auto-reusing or bootstrapping the leader team when needed.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
        name: z.string().describe('Descriptive name for the teammate'),
        model: z.string().optional().describe('Model to use for this teammate'),
      }),
    },
  );
}

function sendMessageTool(deps: Pick<ConversationDeps, 'registry' | 'runtime'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const team = target.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        ensureRunningTeam(deps.runtime, team.teamId, team.status);
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
      description: 'Send a message to a teammate or broadcast to the active team.',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
        message: z.string().describe('The message content'),
        memberId: z.string().optional().describe('Specific member ID to message (omit for broadcast)'),
      }),
    },
  );
}

function planJobsTool(deps: Pick<ConversationDeps, 'registry' | 'runtime'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const team = target.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        ensureRunningTeam(deps.runtime, team.teamId, team.status);
        const board = deps.registry.getJobBoard(team.teamId);
        const created = board.planJobs(input.jobs);
        const emitEvent = deps.runtime.createEmitEvent(team.teamId);
        for (const job of created) {
          emitEvent({
            type: 'job.created',
            data: {teamId: team.teamId, jobId: job.id, title: job.title, priority: job.priority},
          });
        }
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
      description: 'Plan work items on the active team job board.',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
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

function assignJobTool(deps: Pick<ConversationDeps, 'registry' | 'runtime'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const team = target.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        ensureRunningTeam(deps.runtime, team.teamId, team.status);
        await deps.runtime.assignJob(team.teamId, input.jobId, input.memberId);
        const board = deps.registry.getJobBoard(team.teamId);
        const job = board.getJob(input.jobId);
        const transport = deps.runtime.getTransport(team.teamId);
        if (job && transport) {
          await transport.send(input.memberId, {
            id: `msg_${crypto.randomUUID().slice(0, 8)}`,
            from: 'leader',
            to: input.memberId,
            teamId: team.teamId,
            type: 'job_assigned',
            content: `Title: ${job.title}\n\nDescription: ${job.description}\n\nJob ID: ${input.jobId}\n\nExecute this job. When done, call team_submit_job with your summary.`,
            metadata: { jobId: input.jobId },
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
      description: 'Assign a ready job to a specific member in the active team.',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
        jobId: z.string().describe('The job ID to assign'),
        memberId: z.string().describe('The member ID to assign the job to'),
      }),
    },
  );
}

function reviewJobTool(deps: Pick<ConversationDeps, 'registry' | 'runtime'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const team = target.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        ensureRunningTeam(deps.runtime, team.teamId, team.status);
        const board = deps.registry.getJobBoard(team.teamId);
        const job = board.getJob(input.jobId);
        if (!job) return JSON.stringify({error: `Job ${input.jobId} not found`});
        const emitEvent = deps.runtime.createEmitEvent(team.teamId);

        if (input.approved) {
          board.completeJob(input.jobId, 'leader');
          emitEvent({
            type: 'job.done',
            data: {teamId: team.teamId, jobId: input.jobId},
          });
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
        }

        board.rejectJob(input.jobId, input.feedback ?? 'Rejected');
        emitEvent({
          type: 'job.reviewed',
          data: {teamId: team.teamId, jobId: input.jobId, approved: false, reviewerId: 'leader'},
        });
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
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'review_job',
      description: 'Review a submitted job in the active team.',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
        jobId: z.string().describe('The job ID to review'),
        approved: z.boolean().describe('Whether to approve or reject the job'),
        feedback: z.string().optional().describe('Feedback for the worker'),
      }),
    },
  );
}

function shutdownTeamTool(deps: Pick<ConversationDeps, 'runtime' | 'sharedState' | 'registry'>): StructuredToolInterface {
  return tool(
    async (input, config) => {
      try {
        const target = resolveTargetTeam(deps.registry, input.teamId, config);
        if (target.error) return JSON.stringify({error: target.error});
        const team = target.team;
        if (!team) return JSON.stringify({error: `Team "${input.teamId ?? '(active)'}" not found`});
        await deps.runtime.shutdownTeam(team.teamId);
        deps.sharedState.removeTeamState(team.teamId);
        return [
          JSON.stringify({ok: true, teamId: team.teamId}),
          new Command({
            update: {
              context: {
                teamSurface: {
                  activeTeamId: undefined,
                  teamRole: 'leader',
                  teamMode: 'leader',
                },
              },
            },
          }),
        ] as const;
      } catch (e) {
        return [
          JSON.stringify({error: e instanceof Error ? e.message : String(e)}),
          undefined,
        ] as const;
      }
    },
    {
      name: 'shutdown_team',
      description: 'Gracefully shut down the active team and return to the default leader context.',
      responseFormat: 'content_and_artifact',
      schema: z.object({
        teamId: z.string().optional().describe('The team ID or name (optional when already in a team context)'),
      }),
    },
  );
}

function readActiveTeamId(config: unknown): string | undefined {
  const parsed = configurableSchema.safeParse(config);
  const context = parsed.success ? parsed.data.configurable?.context : undefined;
  const teamSurface = context?.teamSurface;
  return teamSurface && typeof teamSurface === 'object' && 'activeTeamId' in teamSurface && typeof teamSurface.activeTeamId === 'string'
    ? teamSurface.activeTeamId
    : undefined;
}

function readExecutionSessionId(config: unknown): string | undefined {
  const parsed = configurableSchema.safeParse(config);
  const sessionId = parsed.success ? parsed.data.configurable?.execution?.sessionId : undefined;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined;
}

function resolveTargetTeam(
  registry: TeamRegistry,
  requestedTeamId: string | undefined,
  config: unknown,
): {team?: ReturnType<TeamRegistry['getTeam']>; error?: string} {
  const activeTeamId = readActiveTeamId(config);
  const normalizedRequestedTeamId = requestedTeamId?.trim();

  if (activeTeamId) {
    if (!normalizedRequestedTeamId) {
      return {team: registry.getTeam(activeTeamId) ?? registry.getTeamByName(activeTeamId)};
    }

    const requestedTeam = registry.getTeam(normalizedRequestedTeamId) ?? registry.getTeamByName(normalizedRequestedTeamId);
    if (requestedTeam && requestedTeam.teamId !== activeTeamId) {
      return {
        error: `Cross-team access is blocked while focused on "${activeTeamId}". Use enter_team to switch focus first.`,
      };
    }
    return {team: requestedTeam};
  }

  if (!normalizedRequestedTeamId) {
    const resumableTeams = registry.listTeams().filter((team) => team.status === 'running' || team.status === 'paused');
    if (resumableTeams.length === 1) {
      return {team: resumableTeams[0]};
    }
    if (resumableTeams.length > 1) {
      return {
        error: 'Multiple teams are available. Use enter_team to switch focus first.',
      };
    }
    return {};
  }

  return {team: registry.getTeam(normalizedRequestedTeamId) ?? registry.getTeamByName(normalizedRequestedTeamId)};
}

async function ensureLeaderTeam(
  registry: TeamRegistry,
  runtime: TeamRuntime,
  config: unknown,
  sessionId: string | undefined,
): Promise<{team?: ReturnType<TeamRegistry['getTeam']>; error?: string}> {
  const activeTeamId = readActiveTeamId(config);
  if (activeTeamId) {
    return {team: registry.getTeam(activeTeamId) ?? registry.getTeamByName(activeTeamId)};
  }

  const existing = resolveTargetTeam(registry, undefined, config);
  if (existing.error || existing.team) {
    return existing;
  }

  const team = registry.createTeam({
    name: `team-${Date.now().toString(36)}`,
    goal: 'Coordinate the current request',
    createdBy: sessionId,
  });
  await runtime.startTeam(team.teamId);
  return {team};
}

function ensureRunningTeam(runtime: TeamRuntime, teamId: string, status: string): void {
  if (status === 'paused') {
    runtime.resumeTeam(teamId);
  }
}

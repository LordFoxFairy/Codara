import type {BaseMiddleware} from '@core/pipeline/types';
import {createAskUserQuestionMiddleware, createBudgetMiddleware, createHILMiddleware, type HILMiddlewareOptions} from '@core/middleware';
import {createChannelHILOptions} from '@integration/channel';
import {createMiddleware} from '@core/pipeline/types';
import {formatToolSummary} from '@shared/tool-display';
import {createPermissionMiddleware} from '@core/middleware/permission';
import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {MemorySharedState} from '@capability/team/shared-state';
import {getToolsForRole} from '@capability/team/surface/tool-filter';
import {createTeamMiddleware} from '@capability/team/middleware';
import type {TeamBusEvent} from '@capability/team/coordination/events';
import type {
  MemberSession,
  MemberSessionOptions,
} from '@capability/team/runtime/member-runner';
import type {PauseRequest} from '@core/agent';
import {bootstrapAgent} from '@core/agent/bootstrap';
import {TeamPersistence} from '@capability/team/persistence';
import {createBuiltinTools} from '@integration/tool';
import type {CodaraRuntimeOptions, TeamQuerySummary, TeamQueryDetail} from '../types';
import type {CodaraModelCatalog} from './runtime';

export interface TeamSystemAssemblyInput {
  options: CodaraRuntimeOptions;
  runtimeStatePath: string;
  projectRoot: string;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  approvalStore?: import('@durability/approval-store').ApprovalStore;
}

export interface TeamSystemAssemblyResult {
  teamRegistry: TeamRegistry;
  teamRuntime: TeamRuntime;
  sharedState: MemorySharedState;
}

export async function assembleTeamSystem(input: TeamSystemAssemblyInput): Promise<TeamSystemAssemblyResult> {
  const {options, runtimeStatePath, projectRoot, catalog, approvalStore} = input;

  const teamRegistry = new TeamRegistry();
  const sharedState = new MemorySharedState();

  // eslint-disable-next-line prefer-const -- declared before closures that read it, assigned later
  let _teamRuntime: TeamRuntime | undefined;
  const getTeamRuntime = (): TeamRuntime => {
    if (!_teamRuntime) throw new Error('TeamRuntime not yet initialized');
    return _teamRuntime;
  };

  const teamSessionFactory = (memberOptions: MemberSessionOptions): MemberSession => {
    const teamToolContext = {
      teamId: memberOptions.teamId,
      memberId: memberOptions.memberId,
      registry: teamRegistry,
      transport: getTeamRuntime().getTransport(memberOptions.teamId)!,
      emitEvent: getTeamRuntime().createEmitEvent(memberOptions.teamId),
      projectRoot,
      runtime: getTeamRuntime(),
    };

    const baseDevTools = createBuiltinTools({
      cwd: options.cwd,
      extended: true,
    });
    const memberTools = getToolsForRole(memberOptions.role, teamToolContext, baseDevTools);

    const memberMiddleware: BaseMiddleware[] = [
      createTeamMiddleware({teamType: 'worker'}),
    ];

    // Inject Permission + HIL middleware so worker pauses bubble to the CLI
    if (options.hil !== false) {
      memberMiddleware.push(createAskUserQuestionMiddleware());
      memberMiddleware.push(createPermissionMiddleware({
        ...(typeof options.hil === 'object' && options.hil !== null ? options.hil : {}),
        cwd: options.cwd,
        projectRoot: options.projectRoot,
        userHome: options.userHome,
      }));
      const baseHilOptions: HILMiddlewareOptions = typeof options.hil === 'object' ? options.hil : {};
      const hilOptions = options.channelRegistry
        ? {...baseHilOptions, ...createChannelHILOptions(options.channelRegistry)}
        : baseHilOptions;
      memberMiddleware.push(createHILMiddleware(hilOptions));
    }

    // Forward worker tool activity to parent runtime events for team panel display
    memberMiddleware.push(createWorkerActivityMiddleware(
      memberOptions.memberId,
      memberOptions.teamId,
      teamToolContext.emitEvent,
    ));

    memberMiddleware.push(createBudgetMiddleware());

    let agentReady: import('@core/agent/models/agent').Agent | undefined;
    let pendingPause: PauseRequest | undefined;

    const ensureAgent = async () => {
      if (agentReady) {
        return agentReady;
      }

      const model = catalog
        ? await (await catalog).create()
        : options.model
          ? await Promise.resolve(options.model)
          : (() => {
              throw new Error('No model available for team worker');
            })();

      agentReady = await bootstrapAgent({
        model,
        agentType: 'subagent',
        tools: memberTools,
        middleware: memberMiddleware,
        systemMessage:
          memberOptions.systemMessage.length > 0
            ? memberOptions.systemMessage
            : undefined,
        runtimeShared: memberOptions.runtimeShared,
      });
      return agentReady;
    };

    function handleAgentResult(result: import('@shared/contracts/agent-types').AgentResult): import('@capability/team/runtime/member-runner').MemberInvokeResult {
      if (result.reason === 'error') {
        pendingPause = undefined;
        return {reason: 'error' as const, error: result.error};
      }
      if (result.state.pendingPause) {
        pendingPause = result.state.pendingPause;
        return {reason: 'paused' as const, pause: result.state.pendingPause};
      }
      pendingPause = undefined;
      return {reason: 'complete' as const};
    }

    return {
      async invoke(input?: string) {
        try {
          const agent = await ensureAgent();
          const result = await agent.invoke(input ?? undefined);
          return handleAgentResult(result);
        } catch (error) {
          return {
            reason: 'error' as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
      async *stream(input?: string) {
        try {
          const agent = await ensureAgent();
          const gen = agent.stream(input ?? undefined);
          let iterResult: IteratorResult<unknown, import('@shared/contracts/agent-types').AgentResult>;
          do {
            iterResult = await gen.next();
            if (!iterResult.done) {
              yield iterResult.value;
            }
          } while (!iterResult.done);
          return handleAgentResult(iterResult.value);
        } catch (error) {
          return {
            reason: 'error' as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
      async resumePause(payload) {
        try {
          const agent = await ensureAgent();
          const result = await agent.resume(payload, {resumeMode: 'tool'});
          return handleAgentResult(result);
        } catch (error) {
          pendingPause = undefined;
          return {
            reason: 'error' as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
      async *resumePauseStream(payload) {
        try {
          const agent = await ensureAgent();
          const gen = agent.resumeStream(payload, {resumeMode: 'tool'});
          let iterResult: IteratorResult<unknown, import('@shared/contracts/agent-types').AgentResult>;
          do {
            iterResult = await gen.next();
            if (!iterResult.done) {
              yield iterResult.value;
            }
          } while (!iterResult.done);
          return handleAgentResult(iterResult.value);
        } catch (error) {
          pendingPause = undefined;
          return {
            reason: 'error' as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
      getPendingPause() {
        return pendingPause;
      },
      async dispose() {
        pendingPause = undefined;
        agentReady = undefined;
      },
    };
  };

  const teamPersistence = new TeamPersistence(runtimeStatePath);

  _teamRuntime = new TeamRuntime({
    registry: teamRegistry,
    projectRoot,
    createSession: teamSessionFactory,
    persistence: teamPersistence,
    approvalStore,
  });

  try {
    const savedSnapshots = teamPersistence.list();
    for (const summary of savedSnapshots) {
      const snapshot = teamPersistence.load(summary.teamId);
      if (snapshot && (snapshot.team.status === 'running' || snapshot.team.status === 'paused')) {
        snapshot.team.status = 'paused';
        teamRegistry.restoreTeam(snapshot.team);
        for (const member of snapshot.members) {
          teamRegistry.restoreMember(member);
        }
        if (snapshot.jobs.length > 0) {
          const board = TeamPersistence.restoreJobBoard(summary.teamId, snapshot.jobs);
          teamRegistry.restoreJobBoard(summary.teamId, board);
        }
        if (snapshot.recentMessages.length > 0) {
          getTeamRuntime().restoreTeamMessages(summary.teamId, snapshot.recentMessages);
        }
      }
    }
  } catch {
    // Recovery is best-effort; a clean start is acceptable.
  }

  const teamRuntime = _teamRuntime;
  return {teamRegistry, teamRuntime, sharedState};
}

export function getTeamSummaries(registry: TeamRegistry | undefined): TeamQuerySummary[] {
  if (!registry) {
    return [];
  }
  return registry.listTeams().map((team) => {
    const board = registry.getJobBoard(team.teamId);
    const progress = board.getProgress();
    const members = registry.getMembersByTeam(team.teamId);
    return {
      teamId: team.teamId,
      name: team.name,
      status: team.status,
      goal: team.goal,
      memberCount: members.length,
      jobProgress: {done: progress.done, total: progress.total},
      startedAt: team.createdAt,
      ...(team.completedAt ? {completedAt: team.completedAt} : {}),
    };
  });
}

export function getTeamDetail(
  registry: TeamRegistry | undefined,
  teamId: string,
): TeamQueryDetail | undefined {
  if (!registry) {
    return undefined;
  }
  const team = registry.getTeam(teamId) ?? registry.getTeamByName(teamId);
  if (!team) {
    return undefined;
  }
  const members = registry.getMembersByTeam(team.teamId);
  const board = registry.getJobBoard(team.teamId);
  const jobs = board.getAllJobs();
  return {
    teamId: team.teamId,
    name: team.name,
    status: team.status,
    goal: team.goal,
    members: members.map((member) => ({
      memberId: member.memberId,
      name: member.name,
      role: member.role,
      status: member.status,
      model: member.model,
      currentJobId: member.currentJobId,
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status,
      assignee: job.assignee,
      blockedBy: job.blockedBy,
    })),
  };
}

/**
 * Lightweight middleware that forwards worker tool activity as team bus events.
 * Enables the team panel to display real-time tool activity per worker.
 */
function createWorkerActivityMiddleware(
  memberId: string,
  teamId: string,
  emitEvent: (event: TeamBusEvent) => void,
): BaseMiddleware {
  return createMiddleware({
    name: 'WorkerActivityMiddleware',
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const args = context.toolCall.args as Record<string, unknown> | undefined;
      const rawSummary = formatToolSummary(toolName, args);
      const summary = rawSummary && rawSummary.length > 50 ? `${rawSummary.slice(0, 49)}…` : rawSummary;
      const label = summary ? `${toolName}(${summary})` : toolName;
      try {
        emitEvent({
          type: 'member.working',
          data: {
            teamId,
            memberId,
            jobId: label,
          },
        });
      } catch { /* best-effort */ }
      return handler(context);
    },
  });
}

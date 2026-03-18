import type {BaseMiddleware} from '@engine/pipeline';
import {createAskUserQuestionMiddleware, createBudgetMiddleware, createHILMiddleware} from '@engine/pipeline';
import {createMiddleware} from '@engine/pipeline/types';
import {createPermissionMiddleware} from '@engine/pipeline/permission';
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
import {bootstrapAgent} from '@engine/agent/bootstrap';
import {TeamPersistence} from '@capability/team/persistence';
import {createBuiltinTools} from '@engine/tool';
import type {CodaraRuntimeOptions, TeamQuerySummary, TeamQueryDetail} from '../types';
import type {CodaraModelCatalog} from './runtime';

export interface TeamSystemAssemblyInput {
  options: CodaraRuntimeOptions;
  codaraPath: string;
  projectRoot: string;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
}

export interface TeamSystemAssemblyResult {
  teamRegistry: TeamRegistry;
  teamRuntime: TeamRuntime;
  sharedState: MemorySharedState;
}

export async function assembleTeamSystem(input: TeamSystemAssemblyInput): Promise<TeamSystemAssemblyResult> {
  const {options, codaraPath, projectRoot, catalog} = input;

  const teamRegistry = new TeamRegistry();
  const sharedState = new MemorySharedState();

  let teamRuntime!: TeamRuntime;

  const teamSessionFactory = (memberOptions: MemberSessionOptions): MemberSession => {
    const teamToolContext = {
      teamId: memberOptions.teamId,
      memberId: memberOptions.memberId,
      registry: teamRegistry,
      transport: teamRuntime.getTransport(memberOptions.teamId)!,
      emitEvent: teamRuntime.createEmitEvent(memberOptions.teamId),
      projectRoot,
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
      memberMiddleware.push(createHILMiddleware(typeof options.hil === 'object' ? options.hil : {}));
    }

    // Forward worker tool activity to parent runtime events for team panel display
    memberMiddleware.push(createWorkerActivityMiddleware(
      memberOptions.memberId,
      memberOptions.teamId,
      teamToolContext.emitEvent,
    ));

    memberMiddleware.push(createBudgetMiddleware());

    let agentReady: import('@engine/agent/models/agent').Agent | undefined;

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

    return {
      async invoke(input?: string) {
        try {
          const agent = await ensureAgent();
          const result = await agent.invoke(input ?? undefined);
          if (result.reason === 'error') {
            return {reason: 'error' as const, error: result.error};
          }
          // Detect HIL pause from the agent state and bubble it up
          if (result.state.pendingPause) {
            teamToolContext.emitEvent({
              type: 'member.paused' as const,
              data: {
                teamId: memberOptions.teamId,
                memberId: memberOptions.memberId,
                pause: result.state.pendingPause,
              },
            });
            return {reason: 'idle' as const};
          }
          return {reason: 'complete' as const};
        } catch (error) {
          return {
            reason: 'error' as const,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
      async dispose() {
        agentReady = undefined;
      },
    };
  };

  const teamPersistence = new TeamPersistence(codaraPath);

  teamRuntime = new TeamRuntime({
    registry: teamRegistry,
    projectRoot,
    createSession: teamSessionFactory,
    persistence: teamPersistence,
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
      }
    }
  } catch {
    // Recovery is best-effort; a clean start is acceptable.
  }

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
      const summary = formatWorkerToolSummary(toolName, args);
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

function formatWorkerToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  switch (toolName) {
    case 'bash':
      return truncateWorkerStr(asWorkerStr(record.command) ?? asWorkerStr(record.description));
    case 'read_file':
    case 'read':
    case 'write_file':
    case 'write':
    case 'edit_file':
    case 'edit':
      return truncateWorkerStr(asWorkerStr(record.file_path) ?? asWorkerStr(record.path));
    case 'glob':
    case 'grep':
      return truncateWorkerStr(asWorkerStr(record.pattern));
    default:
      return undefined;
  }
}

function asWorkerStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function truncateWorkerStr(value: string | undefined, max = 50): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

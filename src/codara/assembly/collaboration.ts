import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@engine/pipeline';
import {createBudgetMiddleware} from '@engine/pipeline';
import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {MemorySharedState} from '@capability/team/shared-state';
import {getToolsForRole} from '@capability/team/surface/tool-filter';
import {createTeamMiddleware} from '@capability/team/middleware';
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
      createBudgetMiddleware(),
    ];

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

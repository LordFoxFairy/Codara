import path from 'node:path';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@engine/pipeline';
import {createBudgetMiddleware} from '@engine/pipeline';
import {TeamRegistry} from '@capability/team/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {createConversationTeamTools} from '@capability/team/tools/conversation-tools';
import {MemorySharedState} from '@capability/team/state/memory-shared-state';
import {getToolsForRole} from '@capability/team/tools/tool-filter';
import {createTeamContextMiddleware} from '@capability/team/middleware/team-context';
import type {MemberSession, MemberSessionOptions} from '@capability/team/runtime/member-runner';
import {bootstrapAgent} from '@engine/agent/bootstrap';
import {TeamPersistence} from '@capability/team/persistence/team-persistence';
import {createBuiltinTools} from '@engine/tool';
import type {CodaraRuntimeOptions, CodaraModelCatalog, TeamQuerySummary, TeamQueryDetail} from './facade';

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
  teamTools: StructuredToolInterface[];
}

export async function assembleTeamSystem(input: TeamSystemAssemblyInput): Promise<TeamSystemAssemblyResult> {
  const {options, codaraPath, projectRoot, catalog} = input;

  const teamRegistry = new TeamRegistry();
  const sharedState = new MemorySharedState();

  // We need a forward reference to teamRuntime for the session factory closure.
  // TeamRuntime is created below; the factory captures it via the `teamRuntime` variable.
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

    // Role-based tool injection:
    // - Leader: only coordination tools (plan_jobs, assign, review, etc.)
    // - Worker: dev tools (bash, read, write...) + worker team tools (claim, submit...)
    const baseDevTools = createBuiltinTools({
      cwd: memberOptions.worktreePath ?? options.cwd,
      extended: true,
    });
    const memberTools = getToolsForRole(memberOptions.role, teamToolContext, baseDevTools);

    // Middleware: team context injection + standard context budget
    // Budget enforcement uses the standard BudgetMiddleware from engine/pipeline.
    // Filesystem isolation relies on worktree + PermissionMiddleware, not a custom PathGuard.
    const memberMiddleware: BaseMiddleware[] = [
      createTeamContextMiddleware(),
      createBudgetMiddleware(),
    ];

    // Resolve model lazily — reuse the same catalog as the main agent
    let agentReady: import('@engine/agent/models/agent').Agent | undefined;

    const ensureAgent = async () => {
      if (agentReady) return agentReady;

      const model = catalog
        ? await (await catalog).create()
        : options.model
          ? await Promise.resolve(options.model)
          : (() => { throw new Error('No model available for team worker'); })();

      agentReady = await bootstrapAgent({
        model,
        agentType: 'subagent',
        tools: memberTools,
        middleware: memberMiddleware,
        systemMessage: memberOptions.systemMessage.length > 0
          ? memberOptions.systemMessage
          : undefined,
        runtimeShared: memberOptions.runtimeShared,
      });
      return agentReady;
    };

    // Adapt Agent -> MemberSession interface
    return {
      async invoke(input?: string) {
        try {
          const agent = await ensureAgent();
          const result = await agent.invoke(input ?? undefined);
          if (result.reason === 'error') {
            return {reason: 'error' as const, error: result.error};
          }
          return {reason: 'complete' as const};
        } catch (err) {
          return {reason: 'error' as const, error: err instanceof Error ? err : new Error(String(err))};
        }
      },
      async dispose() {
        // Agent doesn't have explicit dispose; release reference
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

  // Recover persisted teams into registry (best-effort)
  try {
    const savedSnapshots = teamPersistence.list();
    for (const summary of savedSnapshots) {
      const snapshot = teamPersistence.load(summary.teamId);
      if (snapshot && (snapshot.team.status === 'running' || snapshot.team.status === 'paused')) {
        // Mark as paused - user must explicitly resume
        snapshot.team.status = 'paused';
        teamRegistry.restoreTeam(snapshot.team);
        for (const m of snapshot.members) {
          teamRegistry.restoreMember(m);
        }
        if (snapshot.jobs.length > 0) {
          const board = TeamPersistence.restoreJobBoard(summary.teamId, snapshot.jobs);
          teamRegistry.restoreJobBoard(summary.teamId, board);
        }
      }
    }
  } catch {
    // Recovery is best-effort - fresh start if it fails
  }

  // Add conversation-driven team tools
  const teamTools = createConversationTeamTools({registry: teamRegistry, runtime: teamRuntime, sharedState});

  return {teamRegistry, teamRuntime, sharedState, teamTools};
}

export function getTeamSummaries(registry: TeamRegistry | undefined): TeamQuerySummary[] {
  if (!registry) return [];
  return registry.listTeams().map(t => {
    const board = registry.getJobBoard(t.teamId);
    const progress = board.getProgress();
    const members = registry.getMembersByTeam(t.teamId);
    return {
      teamId: t.teamId,
      name: t.name,
      status: t.status,
      goal: t.goal,
      memberCount: members.length,
      jobProgress: { done: progress.done, total: progress.total },
    };
  });
}

export function getTeamDetail(registry: TeamRegistry | undefined, teamId: string): TeamQueryDetail | undefined {
  if (!registry) return undefined;
  const team = registry.getTeam(teamId) ?? registry.getTeamByName(teamId);
  if (!team) return undefined;
  const members = registry.getMembersByTeam(team.teamId);
  const board = registry.getJobBoard(team.teamId);
  const jobs = board.getAllJobs();
  return {
    teamId: team.teamId,
    name: team.name,
    status: team.status,
    goal: team.goal,
    members: members.map(m => ({
      memberId: m.memberId,
      name: m.name,
      role: m.role,
      status: m.status,
      model: m.model,
      currentJobId: m.currentJobId,
    })),
    jobs: jobs.map(j => ({
      id: j.id,
      title: j.title,
      status: j.status,
      assignee: j.assignee,
      blockedBy: j.blockedBy,
    })),
  };
}

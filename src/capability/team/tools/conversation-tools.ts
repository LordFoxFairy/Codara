import {tool} from '@langchain/core/tools';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TeamRegistry} from '@capability/team/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {SharedState} from '@capability/team/state/shared-state';

// ─── Factory ────────────────────────────────────────────────────────

/**
 * High-level team tools for the main Codara agent.
 * These allow conversational team creation and management
 * (as opposed to the internal leader/worker tools).
 */
export function createConversationTeamTools(deps: {
  registry: TeamRegistry;
  runtime: TeamRuntime;
  sharedState: SharedState;
}): StructuredToolInterface[] {
  return [
    createTeamTool(deps),
    listTeamsTool(deps),
    teamStatusTool(deps),
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
        return JSON.stringify({teamId: team.teamId, name: team.name, status: 'started'});
      } catch (e) {
        return JSON.stringify({error: e instanceof Error ? e.message : String(e)});
      }
    },
    {
      name: 'create_team',
      description:
        'Create a new team to work on a complex goal. Use when the task requires multiple parallel workstreams or specialized agents. The team will have a leader that coordinates workers.',
      schema: z.object({
        goal: z.string().describe('The goal for the team'),
        name: z.string().optional().describe('Optional team name'),
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

import {createMiddleware} from '@engine/pipeline/types';
import type {BaseMiddleware, BeforeModelContext} from '@engine/pipeline/types';
import type {TeamRegistry} from '@capability/team/coordination/team-registry';
import type {TeamRuntime} from '@capability/team/runtime/team-runtime';
import type {SharedState} from '@capability/team/shared-state';
import {createConversationTeamTools} from '@capability/team/surface/conversation-tools';

export const TEAM_MIDDLEWARE_NAME = 'TeamMiddleware';

export type TeamType = 'leader' | 'worker';

export interface TeamSurfaceState {
  activeTeamId?: string;
  teamRole?: 'leader' | 'worker';
  teamMode?: 'leader' | 'worker';
}

export interface TeamRuntimeContext {
  teamId: string;
  memberId: string;
  memberName: string;
  role: 'leader' | 'worker' | 'reviewer';
  teamName: string;
  goal: string;
  depth: number;
  maxDepth: number;
  drainInbox: () => Promise<string[]>;
  getProtocol: () => string;
}

export function readTeamContext(context: BeforeModelContext): TeamRuntimeContext | undefined {
  return context.runtime.shared?.teamContext as TeamRuntimeContext | undefined;
}

export function readTeamSurfaceState(context: BeforeModelContext): TeamSurfaceState | undefined {
  const value = context.runtime.context.teamSurface;
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as TeamSurfaceState;
}

export function createTeamMiddleware(
  options:
    | {
        teamType: 'leader';
        registry: TeamRegistry;
        runtime: TeamRuntime;
        sharedState: SharedState;
        name?: string;
      }
    | {
        teamType: 'worker';
        name?: string;
      },
): BaseMiddleware {
  if (options.teamType === 'worker') {
    let protocolInjected = false;

    return createMiddleware({
      name: options.name?.trim() || TEAM_MIDDLEWARE_NAME,
      async beforeModel(context) {
        const teamCtx = readTeamContext(context);
        if (!teamCtx) return;

        if (!protocolInjected) {
          context.systemMessage.push(teamCtx.getProtocol());
          protocolInjected = true;
        }

        const formattedMessages = await teamCtx.drainInbox();
        if (formattedMessages.length > 0) {
          context.systemMessage.push([
            '--- Team Inbox ---',
            ...formattedMessages,
            '--- End Inbox ---',
          ].join('\n'));
        }
      },
    });
  }

  return createMiddleware({
    name: options.name?.trim() || TEAM_MIDDLEWARE_NAME,
    tools: createConversationTeamTools(options),
    beforeModel(context) {
      const surface = readTeamSurfaceState(context);
      if (!surface?.activeTeamId || surface.teamRole !== 'leader') {
        return;
      }

      const team = options.registry.getTeam(surface.activeTeamId) ?? options.registry.getTeamByName(surface.activeTeamId);
      if (!team) {
        return;
      }

      context.systemMessage.push([
        '## Team Leader Context',
        `You are currently leading team "${team.name}" (${team.teamId}).`,
        `Goal: ${team.goal}`,
        'Use team collaboration tools to plan work, spawn teammates, assign jobs, review results, and coordinate the team.',
      ].join('\n'));
    },
  });
}

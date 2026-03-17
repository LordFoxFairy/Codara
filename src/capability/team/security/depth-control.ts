import type { Team } from '@capability/team/types';
import { SECURITY_DEFAULTS } from '@capability/team/types';

/** Check if a sub-team can be created under the given team */
export function canCreateSubTeam(team: Team): boolean {
  return team.config.allowSubTeams && team.depth < team.config.maxDepth;
}

/** Check if a new member can be spawned in the team */
export function canSpawnMember(
  teamMemberCount: number,
  teamMaxMembers: number,
  globalAgentCount: number,
): boolean {
  return teamMemberCount < teamMaxMembers
    && globalAgentCount < SECURITY_DEFAULTS.maxTotalAgents;
}

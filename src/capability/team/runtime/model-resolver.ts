import type { TeamMember, Team } from '@capability/team/types';

/**
 * Resolve the model to use for a team member.
 * 4-level cascade: member override → role default → team default → global fallback.
 */
export function resolveModel(
  member: TeamMember,
  team: Team,
  globalDefault: string,
): string {
  return member.model
    ?? team.config.modelCascade[member.role]
    ?? team.config.modelCascade.default
    ?? globalDefault;
}

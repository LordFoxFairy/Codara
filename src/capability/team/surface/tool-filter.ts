import type {StructuredToolInterface} from '@langchain/core/tools';
import type {MemberRole} from '@capability/team/coordination/types';
import {createLeaderTools} from '@capability/team/surface/leader-tools';
import {createWorkerTools} from '@capability/team/surface/worker-tools';
import type {TeamToolContext} from '@capability/team/surface/types';

const BLOCKED_FOR_WORKER = new Set(['Task']);

export function getToolsForRole(
  role: MemberRole,
  ctx: TeamToolContext,
  baseTools: StructuredToolInterface[] = [],
): StructuredToolInterface[] {
  switch (role) {
    case 'leader':
      return createLeaderTools(ctx);

    case 'worker':
      return [
        ...baseTools.filter((t) => !BLOCKED_FOR_WORKER.has(t.name)),
        ...createWorkerTools(ctx),
      ];
  }
}

export function isTeamTool(tool: StructuredToolInterface): boolean {
  return tool.name.startsWith('team_');
}

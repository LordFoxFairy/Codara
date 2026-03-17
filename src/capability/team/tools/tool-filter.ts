import type {StructuredToolInterface} from '@langchain/core/tools';
import type {MemberRole} from '@capability/team/types';
import {createLeaderTools} from './leader-tools';
import {createWorkerTools} from './worker-tools';
import {createReviewerTools} from './reviewer-tools';
import type {TeamToolContext} from './types';

// Tools that are read-only (safe for reviewers)
const READ_ONLY_TOOL_NAMES = new Set([
  'read_file', 'glob', 'grep', 'bash', 'web_search', 'fetch_url', 'notebook_read',
]);

// Tools blocked for workers (prevent confusion with team jobs)
const BLOCKED_FOR_WORKER = new Set(['Task']);

export function getToolsForRole(
  role: MemberRole,
  ctx: TeamToolContext,
  baseTools: StructuredToolInterface[] = [],
): StructuredToolInterface[] {
  switch (role) {
    case 'leader':
      // Leader only gets team coordination tools, no dev tools
      return createLeaderTools(ctx);

    case 'worker':
      // Dev tools (minus blocked ones) + worker team tools
      return [
        ...baseTools.filter((t) => !BLOCKED_FOR_WORKER.has(t.name)),
        ...createWorkerTools(ctx),
      ];

    case 'reviewer':
      // Read-only dev tools + reviewer team tools
      return [
        ...baseTools.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name)),
        ...createReviewerTools(ctx),
      ];
  }
}

export function isTeamTool(tool: StructuredToolInterface): boolean {
  return tool.name.startsWith('team_');
}

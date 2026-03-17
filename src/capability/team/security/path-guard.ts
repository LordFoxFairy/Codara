import { resolve } from 'node:path';

/** Check if a target path is within the member's worktree */
export function isAllowedPath(memberWorktree: string, targetPath: string): boolean {
  const resolvedTarget = resolve(targetPath);
  const resolvedWorktree = resolve(memberWorktree);
  return resolvedTarget.startsWith(resolvedWorktree + '/') || resolvedTarget === resolvedWorktree;
}

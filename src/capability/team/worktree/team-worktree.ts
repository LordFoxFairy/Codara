import {exec} from 'child_process';
import {promisify} from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────

export interface WorktreeInfo {
  memberName: string;
  branchName: string;
  worktreePath: string;
}

// ─── Create ───────────────────────────────────────────────────────────

/** Create a git worktree for a team member. Returns the worktree path. */
export async function createMemberWorktree(
  teamId: string,
  memberName: string,
  projectRoot: string,
  baseBranch: string = 'HEAD',
): Promise<string> {
  const worktreePath = path.join(projectRoot, '.codara/worktrees', teamId, memberName);
  const branchName = `team/${teamId}/${memberName}`;

  await execAsync(`git branch "${branchName}" "${baseBranch}"`, {cwd: projectRoot});
  await execAsync(`git worktree add "${worktreePath}" "${branchName}"`, {cwd: projectRoot});

  return worktreePath;
}

// ─── Remove ───────────────────────────────────────────────────────────

/** Remove a member's worktree and optionally delete the branch. */
export async function removeMemberWorktree(
  teamId: string,
  memberName: string,
  projectRoot: string,
  deleteBranch: boolean = true,
): Promise<void> {
  const worktreePath = path.join(projectRoot, '.codara/worktrees', teamId, memberName);
  const branchName = `team/${teamId}/${memberName}`;

  await execAsync(`git worktree remove "${worktreePath}" --force`, {cwd: projectRoot});

  if (deleteBranch) {
    await execAsync(`git branch -D "${branchName}"`, {cwd: projectRoot});
  }
}

// ─── List ─────────────────────────────────────────────────────────────

/** List all worktrees for a team. */
export async function listTeamWorktrees(
  teamId: string,
  projectRoot: string,
): Promise<WorktreeInfo[]> {
  const teamDir = path.join(projectRoot, '.codara/worktrees', teamId);
  try {
    const entries = await fs.readdir(teamDir);
    return entries.map((name) => ({
      memberName: name,
      branchName: `team/${teamId}/${name}`,
      worktreePath: path.join(teamDir, name),
    }));
  } catch {
    return [];
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────

/** Remove all worktrees for a team. */
export async function cleanupTeamWorktrees(
  teamId: string,
  projectRoot: string,
): Promise<void> {
  const worktrees = await listTeamWorktrees(teamId, projectRoot);
  for (const wt of worktrees) {
    await removeMemberWorktree(teamId, wt.memberName, projectRoot, true);
  }
  const teamDir = path.join(projectRoot, '.codara/worktrees', teamId);
  await fs.rm(teamDir, {recursive: true, force: true});
}

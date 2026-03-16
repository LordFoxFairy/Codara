/**
 * Git Worktree 隔离管理器。
 *
 * 为子代理创建独立工作目录，避免并发写文件冲突。
 * 通过 `git worktree add` / `git worktree remove` 管理生命周期。
 */

import {execSync} from 'node:child_process';

/** 检测指定目录是否为 Git 仓库（或 worktree）。 */
export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: 'pipe',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export interface CreateWorktreeOptions {
  /** 主仓库根目录。 */
  repoRoot: string;
  /** 用作 worktree 分支名后缀的 session/agent ID。 */
  sessionId: string;
  /** 基础分支，默认 HEAD。 */
  baseBranch?: string;
}

export interface CreateWorktreeResult {
  /** worktree 路径。 */
  worktreePath: string;
  /** 创建的分支名。 */
  branch: string;
}

/**
 * 创建 Git worktree。
 *
 * 在 `.codara/worktrees/<sessionId>` 下创建新的 worktree，
 * 基于指定分支（默认 HEAD）。
 */
export function createWorktree(options: CreateWorktreeOptions): CreateWorktreeResult {
  const {repoRoot, sessionId, baseBranch} = options;
  const branch = `codara/worktree-${sessionId}`;
  const worktreePath = `${repoRoot}/.codara/worktrees/${sessionId}`;
  const base = baseBranch ?? 'HEAD';

  execSync(`git worktree add -b "${branch}" "${worktreePath}" "${base}"`, {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 30_000,
  });

  return {worktreePath, branch};
}

export interface RemoveWorktreeOptions {
  /** 主仓库根目录。 */
  repoRoot: string;
  /** worktree 路径。 */
  worktreePath: string;
  /** 关联的分支名（可选，传入时会删除分支）。 */
  branch?: string;
}

/**
 * 移除 Git worktree 并清理关联分支。
 */
export function removeWorktree(options: RemoveWorktreeOptions): void {
  const {repoRoot, worktreePath, branch} = options;

  execSync(`git worktree remove "${worktreePath}" --force`, {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 30_000,
  });

  if (branch) {
    try {
      execSync(`git branch -D "${branch}"`, {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 10_000,
      });
    } catch {
      // 分支可能已不存在，忽略
    }
  }
}

/**
 * 检测 worktree 是否有未提交变更。
 */
export function hasWorktreeChanges(worktreePath: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: worktreePath,
      stdio: 'pipe',
      timeout: 10_000,
      encoding: 'utf-8',
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

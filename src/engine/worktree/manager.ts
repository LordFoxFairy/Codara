/**
 * Git Worktree 隔离管理器。
 *
 * 为子代理创建独立工作目录，避免并发写文件冲突。
 * 通过 `git worktree add` / `git worktree remove` 管理生命周期。
 */

import {spawnSync} from 'node:child_process';

const SAFE_NAME_RE = /^[a-zA-Z0-9._\-\/]+$/;

function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME_RE.test(value)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
}

function git(args: string[], cwd: string, timeoutMs = 30_000): string {
  const result = spawnSync('git', args, {cwd, stdio: 'pipe', timeout: timeoutMs, encoding: 'utf-8'});
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args[0]} failed with exit code ${result.status}`);
  }
  return result.stdout ?? '';
}

/** 检测指定目录是否为 Git 仓库（或 worktree）。 */
export function isGitRepo(cwd: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd, 5_000);
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

  assertSafeName(sessionId, 'sessionId');
  if (baseBranch) assertSafeName(baseBranch, 'baseBranch');

  const branch = `codara/worktree-${sessionId}`;
  const worktreePath = `${repoRoot}/.codara/worktrees/${sessionId}`;
  const base = baseBranch ?? 'HEAD';

  git(['worktree', 'add', '-b', branch, worktreePath, base], repoRoot);

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

  git(['worktree', 'remove', worktreePath, '--force'], repoRoot);

  if (branch) {
    assertSafeName(branch, 'branch');
    try {
      git(['branch', '-D', branch], repoRoot, 10_000);
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
    const output = git(['status', '--porcelain'], worktreePath, 10_000);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/** Git Worktree 管理工具。 */

import {execFile as execFileCb} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {promisify} from 'node:util';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, getErrorMessage} from '@engine/tool/utils';

const execFile = promisify(execFileCb);

// ── Git helpers ─────────────────────────────────────────────────────────

async function runGit(args: string[], cwd: string): Promise<{stdout: string; stderr: string}> {
  return execFile('git', args, {cwd, timeout: 30_000});
}

/** 获取 git 仓库根目录，失败返回 null。 */
async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const {stdout} = await runGit(['rev-parse', '--show-toplevel'], cwd);
    return stdout.trim();
  } catch {
    return null;
  }
}

/** 检查分支是否已存在。 */
async function branchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', branch], cwd);
    return true;
  } catch {
    return false;
  }
}

function randomId(): string {
  return randomBytes(4).toString('hex');
}

// ── EnterWorktreeTool ───────────────────────────────────────────────────

const enterWorktreeSchema = z.object({
  branch: z
    .string()
    .optional()
    .describe('Branch name for the worktree. If omitted, creates a new branch from current HEAD.'),
  path: z
    .string()
    .optional()
    .describe('Directory path for the worktree. If omitted, auto-generates in .codara/worktrees/'),
});

type EnterWorktreeInput = z.infer<typeof enterWorktreeSchema>;

export class EnterWorktreeTool extends StructuredTool<typeof enterWorktreeSchema> {
  name = 'enter_worktree';
  description = `Creates or enters a git worktree for isolated parallel work.
Use when: an agent needs its own working directory to avoid conflicting with the main workspace.
Returns: the worktree path and branch name on success, or an error message.`;
  schema = enterWorktreeSchema;

  async _call(input: EnterWorktreeInput): Promise<string> {
    const cwd = process.cwd();
    const repoRoot = await getRepoRoot(cwd);
    if (!repoRoot) {
      return formatError('Not a git repository', 'current directory is not inside a git repo');
    }

    const id = randomId();
    const branch = input.branch ?? `worktree/${id}`;
    const worktreePath = input.path ?? path.join(repoRoot, '.codara', 'worktrees', branch.replace(/\//g, '-'));

    try {
      const exists = await branchExists(branch, repoRoot);
      if (exists) {
        // 分支已存在 — checkout 到该分支
        await runGit(['worktree', 'add', worktreePath, branch], repoRoot);
      } else {
        // 创建新分支
        await runGit(['worktree', 'add', '-b', branch, worktreePath], repoRoot);
      }
    } catch (error: unknown) {
      return formatError('Worktree creation failed', getErrorMessage(error));
    }

    return `Worktree created successfully.\nPath: ${worktreePath}\nBranch: ${branch}`;
  }
}

export function createEnterWorktreeTool(): EnterWorktreeTool {
  return new EnterWorktreeTool();
}

// ── ExitWorktreeTool ────────────────────────────────────────────────────

const exitWorktreeSchema = z.object({
  path: z.string().describe('Path of the worktree to remove.'),
  force: z.boolean().default(false).describe('Force removal even with uncommitted changes.'),
});

type ExitWorktreeInput = z.infer<typeof exitWorktreeSchema>;

export class ExitWorktreeTool extends StructuredTool<typeof exitWorktreeSchema> {
  name = 'exit_worktree';
  description = `Removes a git worktree and cleans up its directory.
Use when: parallel work is done and the worktree is no longer needed.
Returns: success message or error.`;
  schema = exitWorktreeSchema;

  async _call(input: ExitWorktreeInput): Promise<string> {
    const cwd = process.cwd();
    const repoRoot = await getRepoRoot(cwd);
    if (!repoRoot) {
      return formatError('Not a git repository', 'current directory is not inside a git repo');
    }

    try {
      const args = ['worktree', 'remove', input.path];
      if (input.force) {
        args.push('--force');
      }
      await runGit(args, repoRoot);
    } catch (error: unknown) {
      return formatError('Worktree removal failed', getErrorMessage(error));
    }

    return `Worktree removed: ${input.path}`;
  }
}

export function createExitWorktreeTool(): ExitWorktreeTool {
  return new ExitWorktreeTool();
}

// ── ListWorktreesTool ───────────────────────────────────────────────────

const listWorktreesSchema = z.object({});

type ListWorktreesInput = z.infer<typeof listWorktreesSchema>;

export class ListWorktreesTool extends StructuredTool<typeof listWorktreesSchema> {
  name = 'list_worktrees';
  description = `Lists all git worktrees in the current repository.
Use when: checking which worktrees exist before creating or removing one.
Returns: formatted list of worktrees with path, HEAD, and branch info.`;
  schema = listWorktreesSchema;

  async _call(_input: ListWorktreesInput): Promise<string> {
    const cwd = process.cwd();
    const repoRoot = await getRepoRoot(cwd);
    if (!repoRoot) {
      return formatError('Not a git repository', 'current directory is not inside a git repo');
    }

    try {
      const {stdout} = await runGit(['worktree', 'list', '--porcelain'], repoRoot);
      if (!stdout.trim()) {
        return 'No worktrees found.';
      }
      return parseWorktreeList(stdout);
    } catch (error: unknown) {
      return formatError('Worktree list failed', getErrorMessage(error));
    }
  }
}

/** 解析 `git worktree list --porcelain` 输出。 */
export function parseWorktreeList(porcelain: string): string {
  const entries: string[] = [];
  let currentPath = '';
  let currentHead = '';
  let currentBranch = '';

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      currentHead = line.slice('HEAD '.length).slice(0, 8);
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length);
    } else if (line === '' && currentPath) {
      entries.push(`${currentPath}  ${currentHead}  [${currentBranch || 'detached'}]`);
      currentPath = '';
      currentHead = '';
      currentBranch = '';
    }
  }

  // 最后一条（如果没有尾部空行）
  if (currentPath) {
    entries.push(`${currentPath}  ${currentHead}  [${currentBranch || 'detached'}]`);
  }

  return entries.join('\n');
}

export function createListWorktreesTool(): ListWorktreesTool {
  return new ListWorktreesTool();
}

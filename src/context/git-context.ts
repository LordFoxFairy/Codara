import {exec} from 'node:child_process';
import {promisify} from 'node:util';

const execAsync = promisify(exec);

export interface GitContext {
  branch: string | undefined;
  status: string | undefined;
  recentCommits: string | undefined;
  userName: string | undefined;
}

const GIT_COMMANDS = {
  branch: 'git branch --show-current',
  status: 'git --no-optional-locks status --short',
  recentCommits: 'git log --oneline -n 5',
  userName: 'git config user.name',
} as const;

const MAX_STATUS_LENGTH = 2000;

export async function fetchGitContext(cwd?: string): Promise<GitContext> {
  const options = cwd ? {cwd, timeout: 5000} : {timeout: 5000};

  const [branch, status, recentCommits, userName] = await Promise.all([
    runGitCommand(GIT_COMMANDS.branch, options),
    runGitCommand(GIT_COMMANDS.status, options).then(s => s?.slice(0, MAX_STATUS_LENGTH)),
    runGitCommand(GIT_COMMANDS.recentCommits, options),
    runGitCommand(GIT_COMMANDS.userName, options),
  ]);

  return {branch, status, recentCommits, userName};
}

export function formatGitContextSection(ctx: GitContext): string | undefined {
  const parts: string[] = [];
  if (ctx.branch) parts.push(`Branch: ${ctx.branch}`);
  if (ctx.userName) parts.push(`Git user: ${ctx.userName}`);
  if (ctx.status) parts.push(`Status:\n${ctx.status}`);
  if (ctx.recentCommits) parts.push(`Recent commits:\n${ctx.recentCommits}`);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

// Cached provider for DynamicSectionRegistry
let cachedContext: GitContext | undefined;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 second cache

export function createGitContextProvider(cwd?: string) {
  return async (): Promise<string | undefined> => {
    const now = Date.now();
    if (cachedContext && now < cacheExpiry) {
      return formatGitContextSection(cachedContext);
    }
    cachedContext = await fetchGitContext(cwd);
    cacheExpiry = now + CACHE_TTL_MS;
    return formatGitContextSection(cachedContext);
  };
}

export function clearGitContextCache(): void {
  cachedContext = undefined;
  cacheExpiry = 0;
}

async function runGitCommand(command: string, options: {cwd?: string; timeout: number}): Promise<string | undefined> {
  try {
    const {stdout} = await execAsync(command, options);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

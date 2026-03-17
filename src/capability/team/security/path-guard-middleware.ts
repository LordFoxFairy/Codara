import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware} from '@engine/pipeline/types';
import {isAllowedPath} from './path-guard';

export const PATH_GUARD_MIDDLEWARE_NAME = 'TeamPathGuardMiddleware';

/** Tools that accept file paths as arguments. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

/** Argument keys that typically contain file paths. */
const PATH_KEYS = ['file_path', 'path', 'directory'];

/**
 * Middleware that enforces filesystem isolation for team workers.
 *
 * When a member has a dedicated worktree, this middleware intercepts
 * file-related tool calls and rejects any that target paths outside
 * the member's worktree boundary.
 */
export function createPathGuardMiddleware(worktreePath: string): BaseMiddleware {
  return createMiddleware({
    name: PATH_GUARD_MIDDLEWARE_NAME,
    async wrapToolCall(context, handler) {
      if (!FILE_TOOLS.has(context.toolCall.name)) {
        return handler(context);
      }

      // Check all path-like arguments
      const args = context.toolCall.args as Record<string, unknown> | undefined;
      if (args) {
        for (const key of PATH_KEYS) {
          const value = args[key];
          if (typeof value === 'string' && value.length > 0) {
            if (!isAllowedPath(worktreePath, value)) {
              return new ToolMessage({
                content: `[PathGuard] Access denied: path "${value}" is outside your worktree (${worktreePath}). Team workers can only access files within their assigned worktree.`,
                tool_call_id: context.toolCall.id ?? '',
              });
            }
          }
        }
      }

      // Also check Bash commands for obvious path escapes
      if (context.toolCall.name === 'Bash') {
        const cmd = (args?.command ?? '') as string;
        if (containsPathEscape(cmd, worktreePath)) {
          return new ToolMessage({
            content: `[PathGuard] Access denied: command appears to access paths outside your worktree (${worktreePath}). Please operate within your assigned workspace.`,
            tool_call_id: context.toolCall.id ?? '',
          });
        }
      }

      return handler(context);
    },
  });
}

/**
 * Simple heuristic: check if a bash command contains `cd` or file
 * operations targeting absolute paths outside the worktree.
 * Not foolproof — defense in depth with OS-level isolation.
 */
function containsPathEscape(command: string, worktreePath: string): boolean {
  // Match absolute paths in the command
  const absolutePaths = command.match(/(?:^|\s|=)(\/[^\s;|&"']+)/g);
  if (!absolutePaths) return false;

  for (const match of absolutePaths) {
    const pathStr = match.trim().replace(/^=/, '');
    // Allow common system paths that tools need
    if (pathStr.startsWith('/usr/') || pathStr.startsWith('/bin/') ||
        pathStr.startsWith('/dev/') || pathStr.startsWith('/tmp/') ||
        pathStr.startsWith('/etc/')) {
      continue;
    }
    if (!isAllowedPath(worktreePath, pathStr)) {
      return true;
    }
  }
  return false;
}

import { describe, test, expect } from 'bun:test';
import { isAllowedPath } from '@capability/team/security/path-guard';

describe('isAllowedPath', () => {
  const worktree = '/project/worktrees/agent-1';

  test('allows path within worktree', () => {
    expect(isAllowedPath(worktree, '/project/worktrees/agent-1/src/index.ts')).toBe(true);
  });

  test('allows worktree root path itself', () => {
    expect(isAllowedPath(worktree, '/project/worktrees/agent-1')).toBe(true);
  });

  test('rejects path outside worktree', () => {
    expect(isAllowedPath(worktree, '/project/worktrees/agent-2/src/index.ts')).toBe(false);
  });

  test('rejects path traversal with ..', () => {
    expect(isAllowedPath(worktree, '/project/worktrees/agent-1/../agent-2/secret.ts')).toBe(false);
  });

  test('rejects absolute path outside worktree', () => {
    expect(isAllowedPath(worktree, '/etc/passwd')).toBe(false);
  });
});

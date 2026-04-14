import {describe, expect, it, beforeEach} from 'bun:test';
import {fetchGitContext, formatGitContextSection, createGitContextProvider, clearGitContextCache, type GitContext} from '@context/git-context';

describe('fetchGitContext', () => {
  it('should fetch git context from current repo', async () => {
    const ctx = await fetchGitContext();
    // We're in a git repo, so branch should be defined
    expect(ctx.branch).toBeDefined();
    expect(typeof ctx.branch).toBe('string');
  });

  it('should return undefined for non-git directory', async () => {
    const ctx = await fetchGitContext('/tmp');
    // /tmp is not a git repo, should gracefully return undefined
    expect(ctx.branch).toBeUndefined();
  });
});

describe('formatGitContextSection', () => {
  it('should format full context', () => {
    const ctx: GitContext = {
      branch: 'main',
      status: 'M src/file.ts',
      recentCommits: 'abc1234 Initial commit',
      userName: 'TestUser',
    };
    const formatted = formatGitContextSection(ctx);
    expect(formatted).toContain('Branch: main');
    expect(formatted).toContain('Git user: TestUser');
    expect(formatted).toContain('M src/file.ts');
    expect(formatted).toContain('abc1234 Initial commit');
  });

  it('should return undefined for empty context', () => {
    const ctx: GitContext = {branch: undefined, status: undefined, recentCommits: undefined, userName: undefined};
    expect(formatGitContextSection(ctx)).toBeUndefined();
  });

  it('should handle partial context', () => {
    const ctx: GitContext = {branch: 'feature/test', status: undefined, recentCommits: undefined, userName: undefined};
    const formatted = formatGitContextSection(ctx);
    expect(formatted).toBe('Branch: feature/test');
  });
});

describe('createGitContextProvider', () => {
  beforeEach(() => {
    clearGitContextCache();
  });

  it('should return a provider function', () => {
    const provider = createGitContextProvider();
    expect(typeof provider).toBe('function');
  });

  it('should cache results', async () => {
    const provider = createGitContextProvider();
    const first = await provider();
    const second = await provider();
    expect(first).toBe(second); // Same reference = cached
  });
});

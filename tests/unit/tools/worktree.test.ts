import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {execSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {
  createEnterWorktreeTool,
  createExitWorktreeTool,
  createListWorktreesTool,
} from '@integration/tool';
import {parseWorktreeList} from '@integration/tool/extended/worktree';

// ── parseWorktreeList 单元测试 ──────────────────────────────────────────

describe('parseWorktreeList', () => {
  it('should parse porcelain output', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc1234def5678',
      'branch refs/heads/main',
      '',
      'worktree /repo/.codara/worktrees/feature',
      'HEAD 9876abcd1234',
      'branch refs/heads/feature',
      '',
    ].join('\n');

    const result = parseWorktreeList(porcelain);
    expect(result).toContain('/repo');
    expect(result).toContain('abc1234d');
    expect(result).toContain('[refs/heads/main]');
    expect(result).toContain('[refs/heads/feature]');
  });

  it('should handle detached HEAD', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc1234def5678',
      'detached',
      '',
    ].join('\n');

    const result = parseWorktreeList(porcelain);
    expect(result).toContain('[detached]');
  });
});

// ── 集成测试（需要 git） ────────────────────────────────────────────────

describe('Worktree tools (integration)', () => {
  let repoDir: string;
  let origCwd: string;

  beforeEach(async () => {
    origCwd = process.cwd();
    repoDir = await mkdtemp(path.join(tmpdir(), 'codara-wt-'));

    // 初始化一个有至少一个 commit 的 git repo
    execSync('git init', {cwd: repoDir});
    execSync('git config user.email "test@test.com"', {cwd: repoDir});
    execSync('git config user.name "Test"', {cwd: repoDir});
    execSync('touch README.md', {cwd: repoDir});
    execSync('git add .', {cwd: repoDir});
    execSync('git commit -m "init"', {cwd: repoDir});

    process.chdir(repoDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    // 清理 worktrees 先，再删 repo
    try {
      execSync('git worktree prune', {cwd: repoDir});
    } catch {
      // ignore
    }
    await rm(repoDir, {recursive: true, force: true});
  });

  it('EnterWorktree should create a worktree with auto-generated branch', async () => {
    const tool = createEnterWorktreeTool();
    const result = await tool.invoke({});

    expect(result).toContain('Worktree created successfully');
    expect(result).toContain('Path:');
    expect(result).toContain('Branch: worktree/');
  });

  it('EnterWorktree should create a worktree with specified branch', async () => {
    const tool = createEnterWorktreeTool();
    const worktreePath = path.join(repoDir, '.codara', 'worktrees', 'my-feature');
    const result = await tool.invoke({branch: 'feature/test', path: worktreePath});

    expect(result).toContain('Worktree created successfully');
    expect(result).toContain(worktreePath);
    expect(result).toContain('Branch: feature/test');
  });

  it('ListWorktrees should show existing worktrees', async () => {
    const enterTool = createEnterWorktreeTool();
    await enterTool.invoke({branch: 'feature/list-test'});

    const listTool = createListWorktreesTool();
    const result = await listTool.invoke({});

    expect(result).toContain(repoDir);
    expect(result).toContain('feature/list-test');
  });

  it('ExitWorktree should remove a worktree', async () => {
    const enterTool = createEnterWorktreeTool();
    const worktreePath = path.join(repoDir, '.codara', 'worktrees', 'to-remove');
    await enterTool.invoke({branch: 'feature/remove-test', path: worktreePath});

    const exitTool = createExitWorktreeTool();
    const result = await exitTool.invoke({path: worktreePath});

    expect(result).toContain('Worktree removed');

    // Verify it's gone from the list
    const listTool = createListWorktreesTool();
    const listResult = await listTool.invoke({});
    expect(listResult).not.toContain('to-remove');
  });

  it('ExitWorktree should return error for invalid path', async () => {
    const tool = createExitWorktreeTool();
    const result = await tool.invoke({path: '/tmp/nonexistent-worktree-xyz'});

    expect(result).toContain('Error');
  });

  it('EnterWorktree should return error outside git repo', async () => {
    const nonRepoDir = await mkdtemp(path.join(tmpdir(), 'codara-no-git-'));
    process.chdir(nonRepoDir);

    const tool = createEnterWorktreeTool();
    const result = await tool.invoke({});

    expect(result).toContain('Error');
    expect(result).toContain('not inside a git repo');

    await rm(nonRepoDir, {recursive: true, force: true});
  });
});

import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {exec} from 'child_process';
import {promisify} from 'util';
import {
  cleanupTeamWorktrees,
  createMemberWorktree,
  listTeamWorktrees,
  removeMemberWorktree,
} from '@capability/team/worktree/team-worktree';

const execAsync = promisify(exec);

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codara-wt-'));
  await execAsync('git init', {cwd: tempDir});
  await execAsync('git config user.email "test@test.com"', {cwd: tempDir});
  await execAsync('git config user.name "test"', {cwd: tempDir});
  await fs.writeFile(path.join(tempDir, 'README.md'), '# Test');
  await execAsync('git add . && git commit -m "init"', {cwd: tempDir});
});

afterEach(async () => {
  try {
    await execAsync('git worktree prune', {cwd: tempDir});
  } catch {}
  await fs.rm(tempDir, {recursive: true, force: true});
});

describe('createMemberWorktree', () => {
  test('creates worktree directory and branch', async () => {
    const wtPath = await createMemberWorktree('t1', 'alice', tempDir);

    // Worktree directory exists
    const stat = await fs.stat(wtPath);
    expect(stat.isDirectory()).toBe(true);

    // Branch exists
    const {stdout} = await execAsync('git branch --list "team/t1/alice"', {cwd: tempDir});
    expect(stdout.trim()).toContain('team/t1/alice');
  });

  test('created worktree has correct branch name', async () => {
    await createMemberWorktree('t1', 'bob', tempDir);

    // Verify the worktree is on the expected branch
    const wtPath = path.join(tempDir, '.codara/worktrees', 't1', 'bob');
    const {stdout} = await execAsync('git rev-parse --abbrev-ref HEAD', {cwd: wtPath});
    expect(stdout.trim()).toBe('team/t1/bob');
  });
});

describe('removeMemberWorktree', () => {
  test('removes worktree and branch', async () => {
    await createMemberWorktree('t1', 'alice', tempDir);
    await removeMemberWorktree('t1', 'alice', tempDir, true);

    // Worktree directory gone
    const exists = await fs.stat(path.join(tempDir, '.codara/worktrees', 't1', 'alice')).catch(() => null);
    expect(exists).toBeNull();

    // Branch gone
    const {stdout} = await execAsync('git branch --list "team/t1/alice"', {cwd: tempDir});
    expect(stdout.trim()).toBe('');
  });

  test('with deleteBranch=false keeps branch', async () => {
    await createMemberWorktree('t1', 'alice', tempDir);
    await removeMemberWorktree('t1', 'alice', tempDir, false);

    // Branch still exists
    const {stdout} = await execAsync('git branch --list "team/t1/alice"', {cwd: tempDir});
    expect(stdout.trim()).toContain('team/t1/alice');
  });
});

describe('listTeamWorktrees', () => {
  test('returns correct list', async () => {
    await createMemberWorktree('t1', 'alice', tempDir);
    await createMemberWorktree('t1', 'bob', tempDir);

    const list = await listTeamWorktrees('t1', tempDir);
    expect(list).toHaveLength(2);

    const names = list.map((w) => w.memberName).sort();
    expect(names).toEqual(['alice', 'bob']);

    const branches = list.map((w) => w.branchName).sort();
    expect(branches).toEqual(['team/t1/alice', 'team/t1/bob']);
  });

  test('returns empty for non-existent team', async () => {
    const list = await listTeamWorktrees('nonexistent', tempDir);
    expect(list).toEqual([]);
  });
});

describe('cleanupTeamWorktrees', () => {
  test('removes all worktrees for team', async () => {
    await createMemberWorktree('t1', 'alice', tempDir);
    await createMemberWorktree('t1', 'bob', tempDir);

    await cleanupTeamWorktrees('t1', tempDir);

    // No worktrees left
    const list = await listTeamWorktrees('t1', tempDir);
    expect(list).toEqual([]);

    // Branches gone
    const {stdout} = await execAsync('git branch --list "team/t1/*"', {cwd: tempDir});
    expect(stdout.trim()).toBe('');

    // Team directory gone
    const exists = await fs.stat(path.join(tempDir, '.codara/worktrees', 't1')).catch(() => null);
    expect(exists).toBeNull();
  });
});

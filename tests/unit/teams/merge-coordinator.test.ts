import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {exec} from 'child_process';
import {promisify} from 'util';
import type {Job} from '@capability/team/types';
import {getMergeOrder, mergeBranch} from '@capability/team/worktree/merge-coordinator';

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────

function mockJob(
  id: string,
  blockedBy: string[] = [],
  status: string = 'done',
  priority: number = 0,
): Job {
  return {
    id,
    teamId: 'team-1',
    title: `Job ${id}`,
    description: '',
    status: status as Job['status'],
    blockedBy,
    blocks: [],
    priority,
    createdAt: new Date().toISOString(),
  };
}

// ─── getMergeOrder ────────────────────────────────────────────────────

describe('getMergeOrder', () => {
  test('empty jobs returns empty result', () => {
    expect(getMergeOrder([])).toEqual([]);
  });

  test('single done job returns it', () => {
    const jobs = [mockJob('A')];
    const order = getMergeOrder(jobs);
    expect(order).toHaveLength(1);
    expect(order[0].id).toBe('A');
  });

  test('linear chain A -> B -> C returns in order', () => {
    const jobs = [mockJob('A'), mockJob('B', ['A']), mockJob('C', ['B'])];
    const order = getMergeOrder(jobs);
    expect(order.map((j) => j.id)).toEqual(['A', 'B', 'C']);
  });

  test('diamond dependency: A first, D last', () => {
    const jobs = [
      mockJob('A', [], 'done', 5),
      mockJob('B', ['A'], 'done', 3),
      mockJob('C', ['A'], 'done', 2),
      mockJob('D', ['B', 'C']),
    ];
    const order = getMergeOrder(jobs);
    expect(order[0].id).toBe('A');
    expect(order[order.length - 1].id).toBe('D');
    expect(order).toHaveLength(4);
  });

  test('ignores non-done jobs', () => {
    const jobs = [mockJob('A'), mockJob('B', [], 'in_progress'), mockJob('C', [], 'planned')];
    const order = getMergeOrder(jobs);
    expect(order).toHaveLength(1);
    expect(order[0].id).toBe('A');
  });

  test('jobs with no dependencies ordered by priority', () => {
    const jobs = [mockJob('A', [], 'done', 1), mockJob('B', [], 'done', 10), mockJob('C', [], 'done', 5)];
    const order = getMergeOrder(jobs);
    // Higher priority first
    expect(order[0].id).toBe('B');
    expect(order[1].id).toBe('C');
    expect(order[2].id).toBe('A');
  });
});

// ─── mergeBranch ──────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codara-merge-'));
  await execAsync('git init', {cwd: tempDir});
  await execAsync('git config user.email "test@test.com"', {cwd: tempDir});
  await execAsync('git config user.name "test"', {cwd: tempDir});
  await fs.writeFile(path.join(tempDir, 'file.txt'), 'base content\n');
  await execAsync('git add . && git commit -m "init"', {cwd: tempDir});
});

afterEach(async () => {
  await fs.rm(tempDir, {recursive: true, force: true});
});

describe('mergeBranch', () => {
  test('clean merge succeeds', async () => {
    // Create a feature branch with a new file
    await execAsync('git checkout -b feature-a', {cwd: tempDir});
    await fs.writeFile(path.join(tempDir, 'new-file.txt'), 'feature content\n');
    await execAsync('git add . && git commit -m "add new file"', {cwd: tempDir});

    // Go back to main
    await execAsync('git checkout master', {cwd: tempDir}).catch(() =>
      execAsync('git checkout main', {cwd: tempDir}),
    );

    const result = await mergeBranch('feature-a', 'master', tempDir);
    expect(result.success).toBe(true);
    expect(result.sourceBranch).toBe('feature-a');
    expect(result.targetBranch).toBe('master');

    // Verify the merge happened
    const merged = await fs.readFile(path.join(tempDir, 'new-file.txt'), 'utf-8');
    expect(merged.trim()).toBe('feature content');
  });

  test('conflict detected and reported', async () => {
    // Create conflicting changes on two branches
    await execAsync('git checkout -b feature-b', {cwd: tempDir});
    await fs.writeFile(path.join(tempDir, 'file.txt'), 'branch b content\n');
    await execAsync('git add . && git commit -m "change on b"', {cwd: tempDir});

    await execAsync('git checkout master', {cwd: tempDir}).catch(() =>
      execAsync('git checkout main', {cwd: tempDir}),
    );
    await fs.writeFile(path.join(tempDir, 'file.txt'), 'main content\n');
    await execAsync('git add . && git commit -m "change on main"', {cwd: tempDir});

    const result = await mergeBranch('feature-b', 'master', tempDir);
    expect(result.success).toBe(false);
    expect(result.conflictFiles).toBeDefined();
    expect(result.conflictFiles!).toContain('file.txt');
  });

  test('repo is clean after conflict detection (merge aborted)', async () => {
    // Create conflicting changes
    await execAsync('git checkout -b feature-c', {cwd: tempDir});
    await fs.writeFile(path.join(tempDir, 'file.txt'), 'branch c content\n');
    await execAsync('git add . && git commit -m "change on c"', {cwd: tempDir});

    await execAsync('git checkout master', {cwd: tempDir}).catch(() =>
      execAsync('git checkout main', {cwd: tempDir}),
    );
    await fs.writeFile(path.join(tempDir, 'file.txt'), 'different main content\n');
    await execAsync('git add . && git commit -m "different change on main"', {cwd: tempDir});

    await mergeBranch('feature-c', 'master', tempDir);

    // Repo should be clean (no merge in progress)
    const {stdout} = await execAsync('git status --porcelain', {cwd: tempDir});
    expect(stdout.trim()).toBe('');
  });
});

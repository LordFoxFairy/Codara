import {exec} from 'child_process';
import {promisify} from 'util';
import type {Job} from '../types.js';

const execAsync = promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────

export interface MergeResult {
  success: boolean;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles?: string[];
  error?: string;
}

// ─── Topological Merge Order ──────────────────────────────────────────

/** Get topological merge order for completed jobs (Kahn's algorithm). */
export function getMergeOrder(jobs: Job[]): Job[] {
  const doneJobs = jobs.filter((j) => j.status === 'done');
  if (doneJobs.length === 0) return [];

  const jobMap = new Map(doneJobs.map((j) => [j.id, j]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const job of doneJobs) {
    inDegree.set(job.id, 0);
    adj.set(job.id, []);
  }

  for (const job of doneJobs) {
    for (const depId of job.blockedBy) {
      if (jobMap.has(depId)) {
        adj.get(depId)!.push(job.id);
        inDegree.set(job.id, (inDegree.get(job.id) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with priority-based tie-breaking
  const queue = doneJobs.filter((j) => inDegree.get(j.id) === 0);
  const result: Job[] = [];

  while (queue.length > 0) {
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue.shift()!;
    result.push(job);

    for (const nextId of adj.get(job.id) ?? []) {
      const newDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, newDeg);
      if (newDeg === 0) {
        queue.push(jobMap.get(nextId)!);
      }
    }
  }

  return result;
}

// ─── Merge ────────────────────────────────────────────────────────────

/** Merge a source branch into a target branch. */
export async function mergeBranch(
  sourceBranch: string,
  targetBranch: string,
  projectRoot: string,
  message?: string,
): Promise<MergeResult> {
  const msg = message ?? `Merge ${sourceBranch} into ${targetBranch}`;
  try {
    await execAsync(`git merge --no-ff "${sourceBranch}" -m "${msg}"`, {cwd: projectRoot});
    return {success: true, sourceBranch, targetBranch};
  } catch (err: any) {
    const stderr: string = err.stderr ?? '';
    const stdout: string = err.stdout ?? '';

    if (stderr.includes('CONFLICT') || stdout.includes('CONFLICT')) {
      const {stdout: statusOut} = await execAsync('git diff --name-only --diff-filter=U', {cwd: projectRoot});
      const conflictFiles = statusOut.trim().split('\n').filter(Boolean);
      await execAsync('git merge --abort', {cwd: projectRoot});
      return {success: false, sourceBranch, targetBranch, conflictFiles};
    }

    return {success: false, sourceBranch, targetBranch, error: err.message};
  }
}

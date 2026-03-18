import type {Job} from './types.js';

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

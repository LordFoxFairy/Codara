import type {Job, JobResult, JobSpec, JobStatus} from '@capability/team/coordination/types';

// ─── Errors ──────────────────────────────────────────────────────────

export class JobBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobBoardError';
  }
}

// ─── JobBoard ────────────────────────────────────────────────────────

export class JobBoard {
  readonly teamId: string;
  private jobs = new Map<string, Job>();

  constructor(teamId: string) {
    this.teamId = teamId;
  }

  // ── Planning ──────────────────────────────────────────────────────

  planJobs(specs: JobSpec[]): Job[] {
    const created: Job[] = [];

    for (const spec of specs) {
      const id = `job_${crypto.randomUUID().slice(0, 8)}`;
      const blockedBy = spec.blockedBy ?? [];

      // Validate that blockedBy references exist (either already on board or in this batch)
      for (const dep of blockedBy) {
        if (!this.jobs.has(dep) && !created.some((j) => j.id === dep)) {
          throw new JobBoardError(`blockedBy references unknown job: ${dep}`);
        }
      }

      const status: JobStatus = blockedBy.length > 0 ? 'planned' : 'ready';

      const job: Job = {
        id,
        teamId: this.teamId,
        title: spec.title,
        description: spec.description,
        status,
        blockedBy: [...blockedBy],
        blocks: [],
        priority: spec.priority ?? 0,
        createdAt: new Date().toISOString(),
      };

      created.push(job);
    }

    // Register all new jobs
    for (const job of created) {
      this.jobs.set(job.id, job);
    }

    // Populate `blocks` on referenced jobs
    for (const job of created) {
      for (const depId of job.blockedBy) {
        const dep = this.jobs.get(depId);
        if (dep && !dep.blocks.includes(job.id)) {
          dep.blocks.push(job.id);
        }
      }
    }

    // Validate DAG integrity
    const {valid, cycle} = this.validateDAG();
    if (!valid) {
      // Roll back: remove the jobs we just added
      for (const job of created) {
        this.jobs.delete(job.id);
      }
      // Also clean up blocks references we added
      for (const job of this.jobs.values()) {
        job.blocks = job.blocks.filter((id) => this.jobs.has(id));
      }
      throw new JobBoardError(`Cycle detected in DAG: ${cycle!.join(' → ')}`);
    }

    return created;
  }

  // ── Claiming ──────────────────────────────────────────────────────

  claimJob(jobId: string, memberId: string): boolean {
    const job = this.mustGet(jobId);

    if (job.status !== 'ready') return false;
    if (job.assignee && job.assignee !== memberId) return false;
    if (this.hasActiveJob(memberId)) return false;

    job.status = 'in_progress';
    job.assignee = memberId;
    job.startedAt = new Date().toISOString();
    return true;
  }

  getClaimable(memberId: string): Job[] {
    if (this.hasActiveJob(memberId)) return [];
    return this.getByStatus('ready');
  }

  // ── Submission ────────────────────────────────────────────────────

  submitJob(jobId: string, result: JobResult): void {
    const job = this.mustGet(jobId);
    if (job.status !== 'in_progress') {
      throw new JobBoardError(`Cannot submit job ${jobId}: status is '${job.status}', expected 'in_progress'`);
    }
    job.status = 'review';
    job.result = result;
  }

  // ── Review ────────────────────────────────────────────────────────

  completeJob(jobId: string, reviewedBy?: string): void {
    const job = this.mustGet(jobId);
    if (job.status !== 'review') {
      throw new JobBoardError(`Cannot complete job ${jobId}: status is '${job.status}', expected 'review'`);
    }
    job.status = 'done';
    job.completedAt = new Date().toISOString();
    if (reviewedBy) job.reviewedBy = reviewedBy;
    this.autoUnblock(jobId);
  }

  rejectJob(jobId: string, _feedback: string): void {
    const job = this.mustGet(jobId);
    if (job.status !== 'review') {
      throw new JobBoardError(`Cannot reject job ${jobId}: status is '${job.status}', expected 'review'`);
    }
    job.status = 'in_progress';
    job.result = undefined;
  }

  // ── Release / Cancel ──────────────────────────────────────────────

  releaseJob(jobId: string): void {
    const job = this.mustGet(jobId);
    if (job.status !== 'in_progress' && job.status !== 'review') {
      throw new JobBoardError(`Cannot release job ${jobId}: status is '${job.status}'`);
    }
    job.status = 'ready';
    job.assignee = undefined;
    job.startedAt = undefined;
    job.result = undefined;
  }

  cancelJob(jobId: string, _reason: string): void {
    const job = this.mustGet(jobId);
    if (job.status === 'in_progress') {
      throw new JobBoardError(`Cannot cancel in-progress job ${jobId}. Release it first.`);
    }
    if (job.status !== 'planned' && job.status !== 'ready') {
      throw new JobBoardError(`Cannot cancel job ${jobId}: status is '${job.status}'`);
    }
    job.status = 'failed';
  }

  failJob(jobId: string, _error: string): void {
    const job = this.mustGet(jobId);
    if (job.status === 'done' || job.status === 'failed') {
      throw new JobBoardError(`Cannot fail job ${jobId}: already in terminal state '${job.status}'`);
    }
    job.status = 'failed';
  }

  // ── Auto-Unblock ──────────────────────────────────────────────────

  private autoUnblock(completedJobId: string): void {
    for (const job of this.jobs.values()) {
      const idx = job.blockedBy.indexOf(completedJobId);
      if (idx === -1) continue;

      job.blockedBy.splice(idx, 1);
      if (job.blockedBy.length === 0 && job.status === 'planned') {
        job.status = 'ready';
      }
    }
  }

  // ── DAG Validation (Kahn's algorithm) ─────────────────────────────

  validateDAG(): {valid: boolean; cycle?: string[]} {
    // Build in-degree map from blockedBy
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>(); // dep → jobs it blocks

    for (const job of this.jobs.values()) {
      if (!inDegree.has(job.id)) inDegree.set(job.id, 0);
      if (!adjList.has(job.id)) adjList.set(job.id, []);

      for (const dep of job.blockedBy) {
        inDegree.set(job.id, (inDegree.get(job.id) ?? 0) + 1);
        if (!adjList.has(dep)) adjList.set(dep, []);
        adjList.get(dep)!.push(job.id);
      }
    }

    // Fix: only count edges from existing jobs
    // Recalculate in-degree counting only deps that are in the graph
    for (const job of this.jobs.values()) {
      let deg = 0;
      for (const dep of job.blockedBy) {
        if (this.jobs.has(dep)) deg++;
      }
      inDegree.set(job.id, deg);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of adjList.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length === this.jobs.size) {
      return {valid: true};
    }

    // Find cycle participants: nodes not in sorted
    const cycle = [...this.jobs.keys()].filter((id) => !sorted.includes(id));
    return {valid: false, cycle};
  }

  // ── Deadlock Detection ────────────────────────────────────────────

  detectDeadlock(): boolean {
    const remaining = [...this.jobs.values()].filter(
      (j) => j.status !== 'done' && j.status !== 'failed',
    );
    if (remaining.length === 0) return false;

    // Deadlock: all remaining jobs are planned and none can become ready
    const hasReady = remaining.some((j) => j.status === 'ready');
    const hasInProgress = remaining.some((j) => j.status === 'in_progress');
    const hasReview = remaining.some((j) => j.status === 'review');

    if (hasReady || hasInProgress || hasReview) return false;

    // All remaining are 'planned' — check if any could become ready
    // (i.e., all their blockedBy are done/failed)
    for (const job of remaining) {
      const allDepsDone = job.blockedBy.every((dep) => {
        const d = this.jobs.get(dep);
        return d && (d.status === 'done' || d.status === 'failed');
      });
      if (allDepsDone) return false; // This one could be unblocked
    }

    return true;
  }

  // ── Queries ───────────────────────────────────────────────────────

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getByStatus(status: JobStatus): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === status);
  }

  getProgress(): {total: number; done: number; inProgress: number; blocked: number} {
    let done = 0;
    let inProgress = 0;
    let blocked = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'done') done++;
      else if (job.status === 'in_progress') inProgress++;
      else if (job.status === 'planned') blocked++;
    }
    return {total: this.jobs.size, done, inProgress, blocked};
  }

  getAllJobs(): Job[] {
    return [...this.jobs.values()];
  }

  // ── Serialization ─────────────────────────────────────────────────

  toJSON(): {teamId: string; jobs: Job[]} {
    return {
      teamId: this.teamId,
      jobs: [...this.jobs.values()],
    };
  }

  static fromJSON(data: {teamId: string; jobs: Job[]}): JobBoard {
    const board = new JobBoard(data.teamId);
    for (const job of data.jobs) {
      board.jobs.set(job.id, {...job});
    }
    return board;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private mustGet(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobBoardError(`Job not found: ${jobId}`);
    return job;
  }

  private hasActiveJob(memberId: string): boolean {
    for (const job of this.jobs.values()) {
      if (job.assignee === memberId && job.status === 'in_progress') return true;
    }
    return false;
  }
}

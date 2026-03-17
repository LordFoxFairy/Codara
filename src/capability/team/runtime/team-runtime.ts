import { join } from 'node:path';
import type { Team, TeamMember, MemberRole } from '@capability/team/types';
import { TeamRegistry } from '@capability/team/team-registry';
import { LocalTransport } from '@capability/team/transport/local-transport';
import { TeamEventEmitter } from '@capability/team/events';
import { MemberRunner } from '@capability/team/runtime/member-runner';
import type { MemberSession, MemberSessionOptions } from '@capability/team/runtime/member-runner';
import { createMemberWorktree, cleanupTeamWorktrees, listTeamWorktrees } from '@capability/team/worktree/team-worktree';
import { mergeBranch, type MergeResult } from '@capability/team/worktree/merge-coordinator';
import type { TeamStore } from '@capability/team/persistence/team-store';
import type { MemberStore } from '@capability/team/persistence/member-store';
import type { JobBoardStore } from '@capability/team/persistence/job-board-store';
import type { SharedState } from '@capability/team/state/shared-state';
import { TeamBudgetTracker } from '@capability/team/budget/budget-tracker';
import { MessageLog } from '@capability/team/persistence/message-log';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamRuntimePersistence {
  teamStore: TeamStore;
  memberStore: MemberStore;
  jobBoardStore: JobBoardStore;
}

export interface TeamRuntimeOptions {
  registry: TeamRegistry;
  projectRoot: string;
  /** Directory for team data (persistence, logs). */
  teamsDir?: string;
  createSession?: (options: MemberSessionOptions) => MemberSession;
  /** Optional persistence — when provided, team/member state auto-saves on changes. */
  persistence?: TeamRuntimePersistence;
  /** Optional shared state — when provided, team status changes are reflected for cross-team visibility. */
  sharedState?: SharedState;
}

// ─── TeamRuntime ────────────────────────────────────────────────────

export class TeamRuntime {
  private runners = new Map<string, MemberRunner>();          // memberId -> runner
  private transports = new Map<string, LocalTransport>();     // teamId -> transport
  private emitters = new Map<string, TeamEventEmitter>();     // teamId -> emitter
  private budgetTrackers = new Map<string, TeamBudgetTracker>(); // teamId -> tracker
  private messageLogs = new Map<string, MessageLog>();        // teamId -> message log
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>(); // teamId -> health check timer

  constructor(private readonly options: TeamRuntimeOptions) {}

  /**
   * Start a team: create transport and emitter.
   *
   * The main Codara agent acts as the team leader (like Claude Code).
   * No separate leader session is spawned — the main agent coordinates
   * workers via conversation tools (spawn_teammate, send_message, etc.).
   */
  async startTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const transport = new LocalTransport();
    const emitter = new TeamEventEmitter();
    const budgetTracker = new TeamBudgetTracker(team.config.budget);
    this.transports.set(teamId, transport);
    this.emitters.set(teamId, emitter);
    this.budgetTrackers.set(teamId, budgetTracker);

    // Message log — persists all team messages to JSONL for replay/audit
    if (this.options.teamsDir) {
      const logPath = join(this.options.teamsDir, teamId, 'messages.jsonl');
      this.messageLogs.set(teamId, new MessageLog(logPath));
    }

    registry.updateTeamStatus(teamId, 'running');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'running');
    emitter.emit({ type: 'team.running', data: { teamId } });

    // Periodic health check — detects deadlocks in the job board
    const healthTimer = setInterval(() => {
      this.checkTeamHealth(teamId);
    }, 5_000);
    this.healthTimers.set(teamId, healthTimer);
  }

  /** Spawn a new member in a running team. */
  async spawnMember(teamId: string, name: string, role: MemberRole, model?: string): Promise<TeamMember> {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const transport = this.transports.get(teamId);
    const emitter = this.emitters.get(teamId);
    if (!transport || !emitter) throw new Error(`Team ${teamId} not started`);

    const member = this.buildMember(teamId, name, role, model);

    // Create git worktree for member isolation (best-effort — team still works without it)
    try {
      const worktreePath = await createMemberWorktree(teamId, name, this.options.projectRoot);
      member.worktreePath = worktreePath;
    } catch {
      // Worktree creation may fail (not a git repo, etc.) — continue without it
    }

    registry.registerMember(teamId, member);
    transport.registerMember(member.memberId);
    this.persistMember(member);

    emitter.emit({
      type: 'member.joined',
      data: { teamId, memberId: member.memberId, name, role, mode: 'local' },
    });

    const runner = new MemberRunner({
      member,
      teamName: team.name,
      goal: team.goal,
      depth: team.depth,
      maxDepth: team.config.maxDepth,
      registry,
      transport,
      emitter,
      projectRoot: this.options.projectRoot,
      createSession: this.options.createSession,
    });

    this.runners.set(member.memberId, runner);

    // Wire inbox-driven wake: when transport delivers a message, wake the runner
    transport.subscribe(member.memberId, (msg) => {
      runner.wake();
      // Persist message to log (best-effort)
      const log = this.messageLogs.get(teamId);
      if (log) { try { log.append(msg); } catch { /* best-effort */ } }
    });

    runner.start().catch(err => this.handleMemberCrash(teamId, member.memberId, err));

    return member;
  }

  /** Graceful shutdown of a team. */
  async shutdownTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const emitter = this.emitters.get(teamId);

    // Cascade: shut down sub-teams first (depth-first)
    const subTeams = this.getSubTeams(teamId);
    for (const subTeamId of subTeams) {
      const subTeam = registry.getTeam(subTeamId);
      if (subTeam && subTeam.status !== 'completed' && subTeam.status !== 'failed' && subTeam.status !== 'archived') {
        await this.shutdownTeam(subTeamId);
      }
    }

    // Request shutdown for all runners belonging to this team
    for (const [memberId, runner] of this.runners) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.requestShutdown();
      }
    }

    // Wait for runners to stop (with timeout)
    const timeout = 10_000;
    const deadline = Date.now() + timeout;
    for (const [memberId, runner] of this.runners) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        const remaining = Math.max(0, deadline - Date.now());
        let timerId: ReturnType<typeof setTimeout>;
        await Promise.race([
          this.waitForTermination(runner),
          new Promise<void>(r => { timerId = setTimeout(r, remaining); }),
        ]);
        clearTimeout(timerId!);
      }
    }

    // Cleanup runners for this team
    for (const [memberId] of [...this.runners]) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        this.runners.delete(memberId);
      }
    }

    registry.updateTeamStatus(teamId, 'completing');

    // Merge worktree branches back to the base branch (best-effort)
    const mergeResults = await this.mergeTeamWorktrees(teamId);
    const failedMerges = mergeResults.filter(r => !r.success);

    registry.updateTeamStatus(teamId, 'completed');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'completed');

    const summary = failedMerges.length > 0
      ? `Team shutdown complete. ${failedMerges.length} merge(s) had conflicts.`
      : 'Team shutdown complete. All branches merged.';
    emitter?.emit({ type: 'team.completed', data: { teamId, summary } });

    // Cleanup worktrees (best-effort — only after merge attempts)
    try {
      await cleanupTeamWorktrees(teamId, this.options.projectRoot);
    } catch {
      // Worktree cleanup may fail — not critical
    }

    const shutdownTimer = this.healthTimers.get(teamId);
    if (shutdownTimer) clearInterval(shutdownTimer);
    this.healthTimers.delete(teamId);

    this.transports.delete(teamId);
    this.emitters.delete(teamId);
    this.budgetTrackers.delete(teamId);
    this.messageLogs.delete(teamId);
  }

  /** Force-kill a team. */
  async killTeam(teamId: string): Promise<void> {
    // Cascade: kill sub-teams first
    const subTeams = this.getSubTeams(teamId);
    for (const subTeamId of subTeams) {
      const subTeam = this.options.registry.getTeam(subTeamId);
      if (subTeam && subTeam.status !== 'completed' && subTeam.status !== 'failed' && subTeam.status !== 'archived') {
        await this.killTeam(subTeamId);
      }
    }

    for (const [memberId, runner] of [...this.runners]) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.requestShutdown();
        this.runners.delete(memberId);
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'failed');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'failed');
    this.emitters.get(teamId)?.emit({ type: 'team.failed', data: { teamId, error: 'Killed by user' } });

    const killTimer = this.healthTimers.get(teamId);
    if (killTimer) clearInterval(killTimer);
    this.healthTimers.delete(teamId);

    this.transports.delete(teamId);
    this.emitters.delete(teamId);
    this.budgetTrackers.delete(teamId);
    this.messageLogs.delete(teamId);
  }

  /** Pause all members of a team. */
  pauseTeam(teamId: string): void {
    for (const [memberId, runner] of this.runners) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.pause();
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'paused');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'paused');
    this.emitters.get(teamId)?.emit({ type: 'team.paused', data: { teamId, reason: 'User requested' } });

    // Pause health check — no point checking a paused team
    const pauseTimer = this.healthTimers.get(teamId);
    if (pauseTimer) clearInterval(pauseTimer);
    this.healthTimers.delete(teamId);
  }

  /** Resume all members of a paused team. */
  resumeTeam(teamId: string): void {
    for (const [memberId, runner] of this.runners) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.resume();
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'running');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'running');
    this.emitters.get(teamId)?.emit({ type: 'team.running', data: { teamId } });

    // Restart health check timer
    const healthTimer = setInterval(() => {
      this.checkTeamHealth(teamId);
    }, 5_000);
    this.healthTimers.set(teamId, healthTimer);
  }

  getRunner(memberId: string): MemberRunner | undefined {
    return this.runners.get(memberId);
  }

  getTransport(teamId: string): LocalTransport | undefined {
    return this.transports.get(teamId);
  }

  getEmitter(teamId: string): TeamEventEmitter | undefined {
    return this.emitters.get(teamId);
  }

  getBudgetTracker(teamId: string): TeamBudgetTracker | undefined {
    return this.budgetTrackers.get(teamId);
  }

  getMessageLog(teamId: string): MessageLog | undefined {
    return this.messageLogs.get(teamId);
  }

  // ── Persistence ─────────────────────────────────────────────────

  private persistTeam(teamId: string): void {
    const { persistence, registry } = this.options;
    if (!persistence) return;
    const team = registry.getTeam(teamId);
    if (team) {
      try { persistence.teamStore.save(team); } catch { /* best-effort */ }
    }
    try { persistence.teamStore.saveRegistry(registry.listTeams()); } catch { /* best-effort */ }
    // Also persist the job board state
    const board = registry.getJobBoard(teamId);
    try { persistence.jobBoardStore.save(board); } catch { /* best-effort */ }
  }

  private persistMember(member: TeamMember): void {
    const { persistence } = this.options;
    if (!persistence) return;
    try { persistence.memberStore.save(member); } catch { /* best-effort */ }
  }

  /** Update shared state with current team status and job summary. */
  private syncSharedState(teamId: string, status: string): void {
    const { sharedState, registry } = this.options;
    if (!sharedState) return;
    const board = registry.getJobBoard(teamId);
    const progress = board.getProgress();
    sharedState.updateTeamState(teamId, {
      status,
      jobsSummary: {total: progress.total, done: progress.done, failed: 0},
    });
  }

  // ── Private ──────────────────────────────────────────────────────

  /** Find direct sub-teams of a given team. */
  private getSubTeams(teamId: string): string[] {
    return this.options.registry.listTeams()
      .filter(t => t.parentTeamId === teamId)
      .map(t => t.teamId);
  }

  private checkTeamHealth(teamId: string): void {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team || team.status !== 'running') return;

    const jobBoard = registry.getJobBoard(teamId);
    if (jobBoard.detectDeadlock()) {
      const emitter = this.emitters.get(teamId);
      emitter?.emit({
        type: 'team.deadlock',
        data: {
          teamId,
          message:
            'All remaining jobs are blocked — no progress path exists. Consider cancelling blocked jobs or adding new unblocked ones.',
        },
      });
    }
  }

  private handleMemberCrash(teamId: string, memberId: string, error: unknown): void {
    const { registry } = this.options;
    const member = registry.getMember(memberId);
    if (!member) return;

    const emitter = this.emitters.get(teamId);

    if (member.role === 'leader') {
      // Leader crash -> pause entire team
      this.pauseTeam(teamId);
      emitter?.emit({ type: 'team.paused', data: { teamId, reason: `Leader crashed: ${error}` } });
    } else {
      // Worker crash -> release their job, emit event
      const jobBoard = registry.getJobBoard(teamId);
      if (member.currentJobId && jobBoard) {
        try { jobBoard.releaseJob(member.currentJobId); } catch { /* job may not be releasable */ }
      }
      emitter?.emit({
        type: 'member.failed',
        data: { teamId, memberId, error: String(error) },
      });
    }
  }

  /** Merge all worktree branches for a team back to the current branch. */
  private async mergeTeamWorktrees(teamId: string): Promise<MergeResult[]> {
    const results: MergeResult[] = [];
    try {
      const worktrees = await listTeamWorktrees(teamId, this.options.projectRoot);
      for (const wt of worktrees) {
        try {
          const result = await mergeBranch(
            wt.branchName,
            'HEAD',
            this.options.projectRoot,
            `merge: team ${teamId} member ${wt.memberName}`,
          );
          results.push(result);
        } catch {
          results.push({success: false, sourceBranch: wt.branchName, targetBranch: 'HEAD', error: 'merge failed'});
        }
      }
    } catch {
      // listTeamWorktrees may fail if no worktrees exist
    }
    return results;
  }

  private waitForTermination(runner: MemberRunner): Promise<void> {
    return new Promise<void>(resolve => {
      const check = () => {
        if (runner.getStatus() === 'terminated') {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private buildMember(teamId: string, name: string, role: MemberRole, model?: string): TeamMember {
    const memberId = `member_${crypto.randomUUID().slice(0, 8)}`;
    return {
      memberId,
      name,
      teamId,
      role,
      status: 'initializing',
      model,
      sessionId: `session-${teamId}-${name}`,
      joinedAt: new Date().toISOString(),
    };
  }
}

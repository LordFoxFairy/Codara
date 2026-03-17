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
import { TeamBudgetTracker } from '@capability/team/budget/budget-tracker';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamRuntimePersistence {
  teamStore: TeamStore;
  memberStore: MemberStore;
}

export interface TeamRuntimeOptions {
  registry: TeamRegistry;
  projectRoot: string;
  createSession?: (options: MemberSessionOptions) => MemberSession;
  /** Optional persistence — when provided, team/member state auto-saves on changes. */
  persistence?: TeamRuntimePersistence;
}

// ─── TeamRuntime ────────────────────────────────────────────────────

export class TeamRuntime {
  private runners = new Map<string, MemberRunner>();          // memberId -> runner
  private transports = new Map<string, LocalTransport>();     // teamId -> transport
  private emitters = new Map<string, TeamEventEmitter>();     // teamId -> emitter
  private budgetTrackers = new Map<string, TeamBudgetTracker>(); // teamId -> tracker

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

    registry.updateTeamStatus(teamId, 'running');
    this.persistTeam(teamId);
    emitter.emit({ type: 'team.running', data: { teamId } });
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
    transport.subscribe(member.memberId, () => runner.wake());

    runner.start().catch(err => this.handleMemberCrash(teamId, member.memberId, err));

    return member;
  }

  /** Graceful shutdown of a team. */
  async shutdownTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const emitter = this.emitters.get(teamId);

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

    this.transports.delete(teamId);
    this.emitters.delete(teamId);
    this.budgetTrackers.delete(teamId);
  }

  /** Force-kill a team. */
  async killTeam(teamId: string): Promise<void> {
    for (const [memberId, runner] of [...this.runners]) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.requestShutdown();
        this.runners.delete(memberId);
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'failed');
    this.persistTeam(teamId);
    this.emitters.get(teamId)?.emit({ type: 'team.failed', data: { teamId, error: 'Killed by user' } });

    this.transports.delete(teamId);
    this.emitters.delete(teamId);
    this.budgetTrackers.delete(teamId);
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
    this.emitters.get(teamId)?.emit({ type: 'team.paused', data: { teamId, reason: 'User requested' } });
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
    this.emitters.get(teamId)?.emit({ type: 'team.running', data: { teamId } });
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

  // ── Persistence ─────────────────────────────────────────────────

  private persistTeam(teamId: string): void {
    const { persistence, registry } = this.options;
    if (!persistence) return;
    const team = registry.getTeam(teamId);
    if (team) {
      try { persistence.teamStore.save(team); } catch { /* best-effort */ }
    }
    try { persistence.teamStore.saveRegistry(registry.listTeams()); } catch { /* best-effort */ }
  }

  private persistMember(member: TeamMember): void {
    const { persistence } = this.options;
    if (!persistence) return;
    try { persistence.memberStore.save(member); } catch { /* best-effort */ }
  }

  // ── Private ──────────────────────────────────────────────────────

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

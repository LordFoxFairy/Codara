import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Team, TeamMember, MemberRole } from '@capability/team/types';
import { TeamRegistry } from '@capability/team/team-registry';
import { LocalTransport } from '@capability/team/transport/local-transport';
import { TeamEventEmitter, type TeamBusEvent } from '@capability/team/events';
import { MemberRunner } from '@capability/team/runtime/member-runner';
import type { MemberSession, MemberSessionOptions } from '@capability/team/runtime/member-runner';
import { createMemberWorktree, cleanupTeamWorktrees, listTeamWorktrees } from '@capability/team/worktree/team-worktree';
import { mergeBranch, type MergeResult } from '@capability/team/worktree/merge-coordinator';
import type { SharedState } from '@capability/team/state/shared-state';
import { TeamPersistence } from '@capability/team/persistence/team-persistence';
import type { TeamMessage } from '@capability/team/types';
import type { CodaraRuntimeEvent, CodaraRuntimeEventPhase, CodaraRuntimeEventStatus } from '@engine/session/runtime-events';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamRuntimeOptions {
  registry: TeamRegistry;
  projectRoot: string;
  /** Directory for team data (persistence, logs). */
  teamsDir?: string;
  createSession?: (options: MemberSessionOptions) => MemberSession;
  /** Optional persistence — when provided, team/member state auto-saves on changes. */
  persistence?: TeamPersistence;
  /** Optional shared state — when provided, team status changes are reflected for cross-team visibility. */
  sharedState?: SharedState;
  /**
   * Direct callback for team runtime events.
   * When provided, TeamRuntime maps internal TeamBusEvents to CodaraRuntimeEvents
   * and delivers them through this callback — no EventBridge or monkey-patching needed.
   */
  onTeamEvent?: (event: CodaraRuntimeEvent) => void;
  /** Session ID (or getter) used when constructing CodaraRuntimeEvents. Required when onTeamEvent is provided. */
  sessionId?: string | (() => string);
}

// ─── TeamRuntime ────────────────────────────────────────────────────

export class TeamRuntime {
  private runners = new Map<string, MemberRunner>();          // memberId -> runner
  private transports = new Map<string, LocalTransport>();     // teamId -> transport
  private emitters = new Map<string, TeamEventEmitter>();     // teamId -> emitter
  private teamMessages = new Map<string, TeamMessage[]>();    // teamId -> in-memory message buffer
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>(); // teamId -> health check timer

  /** Root event IDs per team — for pairing start/end runtime events. */
  private readonly teamRootIds = new Map<string, string>();
  /** Cached metadata per team — for enriching runtime events. */
  private readonly teamMeta = new Map<string, { name: string; goal: string; memberCount: number; jobTotal: number; jobDone: number }>();

  /** Mutable callback — can be set after construction via setOnTeamEvent(). */
  private onTeamEventCallback?: (event: CodaraRuntimeEvent) => void;
  private sessionIdGetter?: string | (() => string);

  constructor(private readonly options: TeamRuntimeOptions) {
    this.onTeamEventCallback = options.onTeamEvent;
    this.sessionIdGetter = options.sessionId;
  }

  /**
   * Set the team event callback and session ID after construction.
   * This allows the callback to be wired after the session is created.
   */
  setOnTeamEvent(callback: (event: CodaraRuntimeEvent) => void, sessionId: string | (() => string)): void {
    this.onTeamEventCallback = callback;
    this.sessionIdGetter = sessionId;
  }

  // ── Runtime Event Mapping ─────────────────────────────────────────

  /**
   * Maps a TeamBusEvent to a CodaraRuntimeEvent and delivers it via the
   * onTeamEvent callback.  This replaces TeamEventBridge — the mapping
   * logic lives inside TeamRuntime so no external bridge or monkey-patching
   * is required.
   */
  private emitTeamEvent(teamId: string, event: TeamBusEvent): void {
    if (!this.onTeamEventCallback || !this.sessionIdGetter) return;
    const sessionId = typeof this.sessionIdGetter === 'function' ? this.sessionIdGetter() : this.sessionIdGetter;

    const runtimeEvent = this.mapBusEventToRuntimeEvent(teamId, event, sessionId);
    if (runtimeEvent) {
      this.onTeamEventCallback(runtimeEvent);
    }
  }

  private makeRuntimeEvent(
    sessionId: string,
    input: { id?: string; kind: 'team'; phase: CodaraRuntimeEventPhase; status: CodaraRuntimeEventStatus; label: string; detail?: string; parentId?: string },
  ): CodaraRuntimeEvent {
    return {
      id: input.id ?? randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      kind: input.kind,
      phase: input.phase,
      status: input.status,
      label: input.label,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    };
  }

  private mapBusEventToRuntimeEvent(teamId: string, event: TeamBusEvent, sessionId: string): CodaraRuntimeEvent | null {
    switch (event.type) {
      case 'team.created': {
        this.teamMeta.set(teamId, {
          name: event.data.name,
          goal: event.data.goal,
          memberCount: 0,
          jobTotal: 0,
          jobDone: 0,
        });
        return null;
      }

      case 'team.running': {
        const rootId = randomUUID();
        this.teamRootIds.set(teamId, rootId);
        const meta = this.teamMeta.get(teamId);
        const name = meta?.name ?? teamId;
        const goal = meta?.goal ?? '';
        const label = goal ? `Team ${name}: ${goal}` : `Team ${name}`;
        return this.makeRuntimeEvent(sessionId, {
          id: rootId,
          kind: 'team',
          phase: 'start',
          status: 'running',
          label,
          detail: `memberCount:0 jobTotal:0`,
        });
      }

      case 'team.paused': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'paused',
          label: `Team ${teamId} paused`,
          detail: event.data.reason,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'team.completing': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'running',
          label: `Team ${teamId} completing`,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'team.completed': {
        const parentId = this.teamRootIds.get(teamId);
        const meta = this.teamMeta.get(teamId);
        const donePart = `done:${meta?.jobDone ?? 0}`;
        const totalPart = `total:${meta?.jobTotal ?? 0}`;
        const membersPart = `members:${meta?.memberCount ?? 0}`;
        const summaryPart = event.data.summary ? `summary:${event.data.summary}` : '';
        const detailParts = [donePart, totalPart, membersPart, summaryPart].filter(Boolean);
        const ev = this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'end',
          status: 'done',
          label: `Team ${teamId} completed`,
          detail: detailParts.join(' ') || undefined,
          ...(parentId ? { parentId } : {}),
        });
        this.teamRootIds.delete(teamId);
        return ev;
      }

      case 'team.failed': {
        const parentId = this.teamRootIds.get(teamId);
        const meta = this.teamMeta.get(teamId);
        const donePart = `done:${meta?.jobDone ?? 0}`;
        const totalPart = `total:${meta?.jobTotal ?? 0}`;
        const errorPart = event.data.error ? `error:${event.data.error}` : '';
        const detailParts = [donePart, totalPart, errorPart].filter(Boolean);
        const ev = this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'end',
          status: 'error',
          label: `Team ${teamId} failed`,
          detail: detailParts.join(' ') || undefined,
          ...(parentId ? { parentId } : {}),
        });
        this.teamRootIds.delete(teamId);
        return ev;
      }

      case 'team.archived':
        return null;

      case 'member.joined': {
        const parentId = this.teamRootIds.get(teamId);
        const meta = this.teamMeta.get(teamId);
        if (meta) meta.memberCount++;
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'running',
          label: `${event.data.name} joined as ${event.data.role}`,
          detail: event.data.memberId,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'member.disconnected':
      case 'member.failed': {
        const parentId = this.teamRootIds.get(teamId);
        const reason = 'error' in event.data ? event.data.error : event.data.reason;
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Member ${event.data.memberId} ${event.type === 'member.failed' ? 'failed' : 'disconnected'}`,
          detail: reason || undefined,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'job.done': {
        const parentId = this.teamRootIds.get(teamId);
        const meta = this.teamMeta.get(teamId);
        if (meta) meta.jobDone++;
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'done',
          label: `Job ${event.data.jobId} completed`,
          detail: event.data.jobId,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'job.failed': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Job ${event.data.jobId} failed`,
          detail: event.data.error || undefined,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'team.deadlock': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Team ${teamId} deadlock detected`,
          detail: event.data.message,
          ...(parentId ? { parentId } : {}),
        });
      }

      case 'team.budget.exceeded': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeRuntimeEvent(sessionId, {
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Team ${teamId} budget exceeded`,
          detail: `action: ${event.data.action}`,
          ...(parentId ? { parentId } : {}),
        });
      }

      default: {
        if (event.type === 'job.created') {
          const meta = this.teamMeta.get(teamId);
          if (meta) meta.jobTotal++;
        }
        return null;
      }
    }
  }

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
    this.transports.set(teamId, transport);
    this.emitters.set(teamId, emitter);

    // In-memory message buffer — persisted as part of TeamSnapshot
    if (!this.teamMessages.has(teamId)) {
      this.teamMessages.set(teamId, []);
    }

    registry.updateTeamStatus(teamId, 'running');
    this.persistTeam(teamId);
    this.syncSharedState(teamId, 'running');
    const runningEvent: TeamBusEvent = { type: 'team.running', data: { teamId } };
    emitter.emit(runningEvent);
    this.emitTeamEvent(teamId, runningEvent);

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

    const joinedEvent: TeamBusEvent = {
      type: 'member.joined',
      data: { teamId, memberId: member.memberId, name, role, mode: 'local' },
    };
    emitter.emit(joinedEvent);
    this.emitTeamEvent(teamId, joinedEvent);

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
      // Buffer message in memory (persisted as part of TeamSnapshot)
      const msgs = this.teamMessages.get(teamId);
      if (msgs) msgs.push(msg);
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
    const completedEvent: TeamBusEvent = { type: 'team.completed', data: { teamId, summary } };
    emitter?.emit(completedEvent);
    this.emitTeamEvent(teamId, completedEvent);

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
    this.teamMessages.delete(teamId);
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
    const failedEvent: TeamBusEvent = { type: 'team.failed', data: { teamId, error: 'Killed by user' } };
    this.emitters.get(teamId)?.emit(failedEvent);
    this.emitTeamEvent(teamId, failedEvent);

    const killTimer = this.healthTimers.get(teamId);
    if (killTimer) clearInterval(killTimer);
    this.healthTimers.delete(teamId);

    this.transports.delete(teamId);
    this.emitters.delete(teamId);
    this.teamMessages.delete(teamId);
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
    const pausedEvent: TeamBusEvent = { type: 'team.paused', data: { teamId, reason: 'User requested' } };
    this.emitters.get(teamId)?.emit(pausedEvent);
    this.emitTeamEvent(teamId, pausedEvent);

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
    const resumeEvent: TeamBusEvent = { type: 'team.running', data: { teamId } };
    this.emitters.get(teamId)?.emit(resumeEvent);
    this.emitTeamEvent(teamId, resumeEvent);

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

  getTeamMessages(teamId: string): TeamMessage[] {
    return this.teamMessages.get(teamId) ?? [];
  }

  // ── Persistence ─────────────────────────────────────────────────

  private persistTeam(teamId: string): void {
    const { persistence, registry } = this.options;
    if (!persistence) return;
    const team = registry.getTeam(teamId);
    if (!team) return;
    try {
      const members = registry.getMembersByTeam(teamId);
      const board = registry.getJobBoard(teamId);
      const messages = this.teamMessages.get(teamId) ?? [];
      const snapshot = TeamPersistence.buildSnapshot(team, members, board, messages);
      persistence.save(teamId, snapshot);
    } catch { /* best-effort */ }
  }

  private persistMember(member: TeamMember): void {
    // Member persistence is now part of the team snapshot — trigger a full team save.
    this.persistTeam(member.teamId);
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
      const deadlockEvent: TeamBusEvent = {
        type: 'team.deadlock',
        data: {
          teamId,
          message:
            'All remaining jobs are blocked — no progress path exists. Consider cancelling blocked jobs or adding new unblocked ones.',
        },
      };
      const emitter = this.emitters.get(teamId);
      emitter?.emit(deadlockEvent);
      this.emitTeamEvent(teamId, deadlockEvent);
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
      const crashEvent: TeamBusEvent = { type: 'team.paused', data: { teamId, reason: `Leader crashed: ${error}` } };
      emitter?.emit(crashEvent);
      this.emitTeamEvent(teamId, crashEvent);
    } else {
      // Worker crash -> release their job, emit event
      const jobBoard = registry.getJobBoard(teamId);
      if (member.currentJobId && jobBoard) {
        try { jobBoard.releaseJob(member.currentJobId); } catch { /* job may not be releasable */ }
      }
      const failEvent: TeamBusEvent = {
        type: 'member.failed',
        data: { teamId, memberId, error: String(error) },
      };
      emitter?.emit(failEvent);
      this.emitTeamEvent(teamId, failEvent);
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

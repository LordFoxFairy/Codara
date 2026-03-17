import { randomUUID } from 'node:crypto';
import type { TeamMember, MemberRole } from '@capability/team/coordination/types';
import { TeamRegistry } from '@capability/team/coordination/team-registry';
import { LocalTransport } from '@capability/team/local-transport';
import type { TeamTransport } from '@capability/team/local-transport';
import type { TeamBusEvent } from '@capability/team/coordination/events';
import { MemberRunner } from '@capability/team/runtime/member-runner';
import type { MemberSession, MemberSessionOptions } from '@capability/team/runtime/member-runner';
import { TeamPersistence } from '@capability/team/persistence';
import type { TeamMessage } from '@capability/team/coordination/types';
import type { CodaraRuntimeEvent, CodaraRuntimeEventPhase, CodaraRuntimeEventStatus } from '@engine/events/runtime-events';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamRuntimeOptions {
  registry: TeamRegistry;
  projectRoot: string;
  /** Agent session factory — created externally (e.g. via bootstrapAgent). */
  agentFactory?: (member: TeamMember) => MemberSession;
  /** Legacy alias for agentFactory — accepts MemberSessionOptions instead of TeamMember. */
  createSession?: (options: MemberSessionOptions) => MemberSession;
  /** Direct callback for runtime events — no EventEmitter or Bridge needed. */
  onTeamEvent?: (event: CodaraRuntimeEvent) => void;
  /** Session ID (or getter) used when constructing CodaraRuntimeEvents. */
  sessionId?: string | (() => string);
  /** Optional persistence — team/member state auto-saves on changes. */
  persistence?: TeamPersistence;
  /** Optional transport — defaults to LocalTransport per team. */
  transport?: TeamTransport;
}

// ─── TeamRuntime ────────────────────────────────────────────────────

export class TeamRuntime {
  private runners = new Map<string, MemberRunner>();          // memberId -> runner
  private transports = new Map<string, TeamTransport>();      // teamId -> transport
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

  // ── Domain Event Emission ───────────────────────────────────────────

  /**
   * Emit a domain event from tools or internal lifecycle.
   * Maps TeamBusEvent → CodaraRuntimeEvent and delivers via onTeamEvent callback.
   * This replaces TeamEventEmitter — tools call this instead of emitter.emit().
   */
  emitDomainEvent(teamId: string, event: TeamBusEvent): void {
    this.emitTeamEvent(teamId, event);
  }

  // ── Runtime Event Mapping ─────────────────────────────────────────

  private emitTeamEvent(teamId: string, event: TeamBusEvent): void {
    // Notify domain event subscribers (SSE, etc.)
    for (const listener of this.eventSubscribers) {
      try { listener(teamId, event); } catch { /* swallow */ }
    }

    // Map to runtime event and deliver via callback
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
   * Start a team: create transport.
   *
   * The main Codara agent acts as the team leader (like Claude Code).
   * No separate leader session is spawned — the main agent coordinates
   * workers via conversation tools (spawn_teammate, send_message, etc.).
   */
  async startTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const transport = this.options.transport ?? new LocalTransport();
    this.transports.set(teamId, transport);

    // In-memory message buffer — persisted as part of TeamSnapshot
    if (!this.teamMessages.has(teamId)) {
      this.teamMessages.set(teamId, []);
    }

    registry.updateTeamStatus(teamId, 'running');
    this.persistTeam(teamId);
    const runningEvent: TeamBusEvent = { type: 'team.running', data: { teamId } };
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
    if (!transport) throw new Error(`Team ${teamId} not started`);

    const member = this.buildMember(teamId, name, role, model);

    registry.registerMember(teamId, member);
    if ('registerMember' in transport) {
      (transport as LocalTransport).registerMember(member.memberId);
    }
    this.persistMember(member);

    const joinedEvent: TeamBusEvent = {
      type: 'member.joined',
      data: { teamId, memberId: member.memberId, name, role, mode: 'local' },
    };
    this.emitTeamEvent(teamId, joinedEvent);

    // Create an emitEvent callback scoped to this team for the tool context
    const emitEvent = (event: TeamBusEvent) => this.emitTeamEvent(teamId, event);

    const runner = new MemberRunner({
      member,
      teamName: team.name,
      goal: team.goal,
      depth: team.depth,
      maxDepth: team.config.maxDepth,
      registry,
      transport,
      emitEvent,
      projectRoot: this.options.projectRoot,
      createSession: this.options.createSession,
    });

    this.runners.set(member.memberId, runner);

    // Wire inbox-driven wake: when transport delivers a message, wake the runner
    if ('subscribe' in transport) {
      (transport as LocalTransport).subscribe(member.memberId, (msg) => {
        runner.wake();
        // Buffer message in memory (persisted as part of TeamSnapshot)
        const msgs = this.teamMessages.get(teamId);
        if (msgs) msgs.push(msg);
      });
    }

    runner.start().catch(err => this.handleMemberCrash(teamId, member.memberId, err));

    return member;
  }

  /** Graceful shutdown of a team. */
  async shutdownTeam(teamId: string): Promise<void> {
    const { registry } = this.options;

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

    registry.updateTeamStatus(teamId, 'completed');
    this.persistTeam(teamId);

    const summary = 'Team shutdown complete.';
    const completedEvent: TeamBusEvent = { type: 'team.completed', data: { teamId, summary } };
    this.emitTeamEvent(teamId, completedEvent);

    const shutdownTimer = this.healthTimers.get(teamId);
    if (shutdownTimer) clearInterval(shutdownTimer);
    this.healthTimers.delete(teamId);

    this.transports.delete(teamId);
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
    const failedEvent: TeamBusEvent = { type: 'team.failed', data: { teamId, error: 'Killed by user' } };
    this.emitTeamEvent(teamId, failedEvent);

    const killTimer = this.healthTimers.get(teamId);
    if (killTimer) clearInterval(killTimer);
    this.healthTimers.delete(teamId);

    this.transports.delete(teamId);
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
    const pausedEvent: TeamBusEvent = { type: 'team.paused', data: { teamId, reason: 'User requested' } };
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
    const resumeEvent: TeamBusEvent = { type: 'team.running', data: { teamId } };
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

  getTransport(teamId: string): TeamTransport | undefined {
    return this.transports.get(teamId);
  }

  getTeamMessages(teamId: string): TeamMessage[] {
    return this.teamMessages.get(teamId) ?? [];
  }

  /**
   * Subscribe to all team domain events.
   * Returns an unsubscribe function.
   * Used by SSE endpoints that need to stream events to clients.
   */
  private eventSubscribers = new Set<(teamId: string, event: TeamBusEvent) => void>();

  subscribeDomainEvents(listener: (teamId: string, event: TeamBusEvent) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => { this.eventSubscribers.delete(listener); };
  }

  /**
   * Create an emitEvent callback scoped to a team.
   * Tools use this to emit domain events without needing a TeamEventEmitter.
   */
  createEmitEvent(teamId: string): (event: TeamBusEvent) => void {
    return (event: TeamBusEvent) => this.emitTeamEvent(teamId, event);
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
      this.emitTeamEvent(teamId, deadlockEvent);
    }
  }

  private handleMemberCrash(teamId: string, memberId: string, error: unknown): void {
    const { registry } = this.options;
    const member = registry.getMember(memberId);
    if (!member) return;

    if (member.role === 'leader') {
      // Leader crash -> pause entire team
      this.pauseTeam(teamId);
      const crashEvent: TeamBusEvent = { type: 'team.paused', data: { teamId, reason: `Leader crashed: ${error}` } };
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
      this.emitTeamEvent(teamId, failEvent);
    }
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

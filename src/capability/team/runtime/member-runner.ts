import type { TeamMember, TeamMessage, MemberRole } from '@capability/team/types';
import type { TeamTransport } from '@capability/team/transport/types';
import type { TeamEventEmitter } from '@capability/team/events';
import type { TeamRegistry } from '@capability/team/team-registry';
import { buildLeaderProtocol } from '@capability/team/protocol/leader-protocol';
import { buildWorkerProtocol } from '@capability/team/protocol/worker-protocol';
import { prepareInboxInjection } from '@capability/team/runtime/message-injector';

// ─── Types ──────────────────────────────────────────────────────────

export type MemberRunnerStatus = 'created' | 'running' | 'idle' | 'paused' | 'terminated';

export interface MemberRunnerOptions {
  member: TeamMember;
  teamName: string;
  goal: string;
  depth: number;
  maxDepth: number;
  registry: TeamRegistry;
  transport: TeamTransport;
  emitter: TeamEventEmitter;
  projectRoot: string;
  /** Session factory — injected for testability. */
  createSession?: (options: MemberSessionOptions) => MemberSession;
}

/** Minimal session interface that MemberRunner needs (for mockability). */
export interface MemberSession {
  invoke(input?: string): Promise<MemberInvokeResult>;
  dispose(): Promise<void>;
}

export interface MemberSessionOptions {
  memberId: string;
  memberName: string;
  role: MemberRole;
  teamId: string;
  tools: unknown[];
  middleware: unknown[];
  systemMessage: string[];
  runtimeShared: Record<string, unknown>;
  worktreePath?: string;
}

export interface MemberInvokeResult {
  reason: 'complete' | 'continue' | 'error' | 'idle';
  error?: Error;
}

// ─── MemberRunner ───────────────────────────────────────────────────

export class MemberRunner {
  private status: MemberRunnerStatus = 'created';
  private session: MemberSession | null = null;
  private wakeResolve: (() => void) | null = null;
  private shutdownRequested = false;

  constructor(private readonly options: MemberRunnerOptions) {}

  getStatus(): MemberRunnerStatus { return this.status; }
  getMemberId(): string { return this.options.member.memberId; }
  getMemberName(): string { return this.options.member.name; }
  getRole(): MemberRole { return this.options.member.role; }
  isShutdownRequested(): boolean { return this.shutdownRequested; }

  /** Start the member's agent loop. Runs until shutdown or error. */
  async start(): Promise<void> {
    if (this.status !== 'created') {
      throw new Error(`Cannot start: status is ${this.status}`);
    }

    this.status = 'running';
    const { member, registry, emitter } = this.options;

    registry.updateMember(member.teamId, member.memberId, { status: 'idle' });
    emitter.emit({ type: 'member.idle', data: { teamId: member.teamId, memberId: member.memberId } });

    try {
      if (this.options.createSession) {
        this.session = this.options.createSession(this.buildSessionOptions());
      }

      await this.runLoop();
    } catch (err) {
      this.status = 'terminated';
      registry.updateMember(member.teamId, member.memberId, { status: 'terminated' });
      emitter.emit({
        type: 'member.failed',
        data: { teamId: member.teamId, memberId: member.memberId, error: String(err) },
      });
      throw err;
    }
  }

  /** Wake the member from idle state. */
  wake(): void {
    if (this.wakeResolve) {
      this.wakeResolve();
      this.wakeResolve = null;
    }
  }

  /** Request graceful shutdown. */
  requestShutdown(): void {
    this.shutdownRequested = true;
    this.wake(); // Wake from idle if sleeping
  }

  /** Pause the member. */
  pause(): void {
    this.status = 'paused';
    const { member, registry, emitter } = this.options;
    registry.updateMember(member.teamId, member.memberId, { status: 'paused' });
    emitter.emit({ type: 'member.paused', data: { teamId: member.teamId, memberId: member.memberId } });
  }

  /** Resume from paused state. */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'idle';
      this.wake();
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    const { member, transport, registry, emitter } = this.options;

    while (!this.shutdownRequested) {
      // Check for pending work without draining — messages are drained
      // by TeamContextMiddleware.drainInbox during session.invoke()
      const hasPending = transport.pendingCount(member.memberId) > 0;
      const hasClaimed = !!registry.getMember(member.memberId)?.currentJobId;

      if (!hasPending && !hasClaimed) {
        this.status = 'idle';
        registry.updateMember(member.teamId, member.memberId, { status: 'idle' });
        emitter.emit({ type: 'member.idle', data: { teamId: member.teamId, memberId: member.memberId } });

        await this.waitForWake();
        if (this.shutdownRequested) break;
        continue;
      }

      // Process work — invoke session which drains inbox via middleware
      this.status = 'running';
      registry.updateMember(member.teamId, member.memberId, { status: 'working' });

      if (this.session) {
        const result = await this.session.invoke();
        if (result.reason === 'error') {
          throw result.error ?? new Error('Agent loop error');
        }
      }
    }

    // Graceful shutdown
    this.status = 'terminated';
    registry.updateMember(member.teamId, member.memberId, { status: 'terminated' });
    emitter.emit({
      type: 'member.left',
      data: { teamId: member.teamId, memberId: member.memberId, reason: 'shutdown' },
    });

    if (this.session) {
      await this.session.dispose();
    }
  }

  private waitForWake(): Promise<void> {
    return new Promise<void>(resolve => {
      this.wakeResolve = resolve;
    });
  }

  private buildSessionOptions(): MemberSessionOptions {
    const { member } = this.options;
    return {
      memberId: member.memberId,
      memberName: member.name,
      role: member.role,
      teamId: member.teamId,
      tools: [],
      middleware: [],
      systemMessage: [],
      runtimeShared: { teamContext: this.buildTeamContext() },
      worktreePath: member.worktreePath,
    };
  }

  private buildTeamContext() {
    const { member, transport } = this.options;
    return {
      teamId: member.teamId,
      memberId: member.memberId,
      memberName: member.name,
      role: member.role,
      teamName: this.options.teamName,
      goal: this.options.goal,
      worktreePath: member.worktreePath,
      depth: this.options.depth,
      maxDepth: this.options.maxDepth,
      drainInbox: async () => {
        const msgs = await transport.receive(member.memberId);
        return prepareInboxInjection(msgs);
      },
      getProtocol: () => this.getProtocolForRole(),
    };
  }

  private getProtocolForRole(): string {
    const { member } = this.options;
    switch (member.role) {
      case 'leader':
        return buildLeaderProtocol({
          teamName: this.options.teamName,
          goal: this.options.goal,
          memberCount: 0,
          depth: this.options.depth,
          maxDepth: this.options.maxDepth,
        });
      case 'worker':
        return buildWorkerProtocol({
          teamName: this.options.teamName,
          memberName: member.name,
          goal: this.options.goal,
          worktreePath: member.worktreePath,
        });
    }
  }
}

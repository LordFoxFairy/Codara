import type { TeamMember, TeamMessage, MemberRole } from '@capability/team/coordination/types';
import type { TeamTransport } from '@capability/team/local-transport';
import type { TeamBusEvent } from '@capability/team/coordination/events';
import type { TeamRegistry } from '@capability/team/coordination/team-registry';
import type {PauseRequest, ResumePayload} from '@core/agent';
import { buildLeaderProtocol, buildWorkerProtocol } from '@capability/team/prompts';

// ─── Inbox Helpers (inlined from former message-injector.ts) ─────────

function sortInbox(messages: TeamMessage[]): TeamMessage[] {
  return [...messages].sort((a, b) => {
    if (a.from === 'user' && b.from !== 'user') return -1;
    if (b.from === 'user' && a.from !== 'user') return 1;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

function formatTeamMessage(msg: TeamMessage): string {
  switch (msg.type) {
    case 'job_assigned':
      return `You have been assigned a job: ${msg.content}`;
    case 'job_submitted':
      return `Job submitted for review: ${msg.content}`;
    case 'job_reviewed': {
      const meta = msg.metadata as { approved?: boolean; feedback?: string } | undefined;
      if (meta?.approved) return `Job approved: ${msg.content}`;
      return `Job rejected. Feedback: ${meta?.feedback ?? msg.content}`;
    }
    case 'job_completed':
      return `Job completed: ${msg.content}`;
    case 'question':
      return `Question from ${msg.from}: ${msg.content}`;
    case 'answer':
      return `Answer from ${msg.from}: ${msg.content}`;
    case 'shutdown_request':
      return 'Team is shutting down. Finish current work and stop.';
    case 'shutdown_response':
      return `${msg.from} acknowledged shutdown.`;
    case 'status_update':
      return `Status update from ${msg.from}: ${msg.content}`;
    case 'merge_conflict':
      return `Merge conflict: ${msg.content}`;
    case 'merge_request':
      return `Merge request: ${msg.content}`;
    case 'code_review':
      return `Code review from ${msg.from}: ${msg.content}`;
    case 'heartbeat':
      return `Heartbeat from ${msg.from}`;
    case 'message':
    default:
      return msg.content;
  }
}

function prepareInboxInjection(messages: TeamMessage[]): string[] {
  const sorted = sortInbox(messages);
  return sorted.map(msg => {
    const formatted = formatTeamMessage(msg);
    return `[Team Message from ${msg.from}] (${msg.type})\n${formatted}`;
  });
}

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
  /** Domain event callback — replaces TeamEventEmitter dependency. */
  emitEvent: (event: TeamBusEvent) => void;
  projectRoot: string;
  /** Session factory — injected for testability. */
  createSession?: (options: MemberSessionOptions) => MemberSession;
}

/** Minimal session interface that MemberRunner needs (for mockability). */
export interface MemberSession {
  invoke(input?: string): Promise<MemberInvokeResult>;
  /** Optional streaming interface — preferred by runLoop when available. */
  stream?(input?: string): AsyncGenerator<unknown, MemberInvokeResult, void>;
  resumePause?(payload: ResumePayload): Promise<MemberInvokeResult>;
  resumePauseStream?(payload: ResumePayload): AsyncGenerator<unknown, MemberInvokeResult, void>;
  getPendingPause?(): PauseRequest | undefined;
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
}

export interface MemberInvokeResult {
  reason: 'complete' | 'continue' | 'error' | 'idle' | 'paused';
  error?: Error;
  pause?: PauseRequest;
}

// ─── MemberRunner ───────────────────────────────────────────────────

export class MemberRunner {
  private status: MemberRunnerStatus = 'created';
  private session: MemberSession | null = null;
  private wakeResolve: (() => void) | null = null;
  private shutdownRequested = false;
  private pauseMode: 'manual' | 'approval' | undefined;

  constructor(private readonly options: MemberRunnerOptions) {}

  getStatus(): MemberRunnerStatus { return this.status; }
  getMemberId(): string { return this.options.member.memberId; }
  getMemberName(): string { return this.options.member.name; }
  getRole(): MemberRole { return this.options.member.role; }
  isShutdownRequested(): boolean { return this.shutdownRequested; }
  getPendingPause(): PauseRequest | undefined { return this.session?.getPendingPause?.(); }
  supportsApprovalResumeStream(): boolean { return Boolean(this.session?.resumePauseStream); }

  /** Start the member's agent loop. Runs until shutdown or error. */
  async start(): Promise<void> {
    if (this.status !== 'created') {
      throw new Error(`Cannot start: status is ${this.status}`);
    }

    this.status = 'running';
    const { member, registry, emitEvent } = this.options;

    registry.updateMember(member.teamId, member.memberId, { status: 'idle' });
    emitEvent({ type: 'member.idle', data: { teamId: member.teamId, memberId: member.memberId } });

    try {
      if (this.options.createSession) {
        this.session = this.options.createSession(this.buildSessionOptions());
      }

      await this.runLoop();
    } catch (err) {
      this.status = 'terminated';
      registry.updateMember(member.teamId, member.memberId, { status: 'terminated' });
      emitEvent({
        type: 'member.failed',
        data: { teamId: member.teamId, memberId: member.memberId, error: String(err) },
      });
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
    this.pauseMode = 'manual';
    this.status = 'paused';
    const { member, registry, emitEvent } = this.options;
    registry.updateMember(member.teamId, member.memberId, { status: 'paused' });
    emitEvent({ type: 'member.paused', data: { teamId: member.teamId, memberId: member.memberId } });
  }

  /** Resume from paused state. */
  resume(): void {
    if (this.status === 'paused' && this.pauseMode === 'manual') {
      this.pauseMode = undefined;
      this.status = 'idle';
      this.wake();
    }
  }

  async resumeApproval(payload: ResumePayload): Promise<MemberInvokeResult> {
    if (!this.session?.resumePause) {
      throw new Error('Member approval resume is not available for this session');
    }
    return this.runApprovalResume(async () => this.session!.resumePause!(payload));
  }

  async *resumeApprovalStream(payload: ResumePayload): AsyncGenerator<unknown, void, void> {
    if (!this.session?.resumePauseStream) {
      throw new Error('Member approval streaming resume is not available for this session');
    }

    const result = yield* this.runApprovalResumeStream(this.session.resumePauseStream(payload));
    this.applyPostResumeState(result);
  }

  // ── Private ──────────────────────────────────────────────────────

  private async handleInvokeError(error: Error): Promise<void> {
    const { member, registry, transport, emitEvent } = this.options;
    const currentMember = registry.getMember(member.memberId);
    if (currentMember?.currentJobId) {
      try {
        const board = registry.getJobBoard(member.teamId);
        const job = board.getJob(currentMember.currentJobId);
        if (job?.status === 'in_progress') {
          board.releaseJob(currentMember.currentJobId);
        } else if (job?.status === 'review') {
          board.rejectJob(currentMember.currentJobId, `Worker crashed: ${error.message}`);
        }
      } catch { /* job may already be handled */ }
      registry.updateMember(member.teamId, member.memberId, { currentJobId: undefined });
    }
    try {
      await transport.send('leader', {
        id: `crash_${crypto.randomUUID().slice(0, 8)}`,
        from: member.memberId,
        to: 'leader',
        teamId: member.teamId,
        type: 'status_update',
        content: `Worker ${member.name} crashed: ${error.message}`,
        timestamp: new Date().toISOString(),
        read: false,
      });
    } catch { /* ignore */ }
    emitEvent({
      type: 'member.failed',
      data: { teamId: member.teamId, memberId: member.memberId, error: error.message },
    });
    this.status = 'idle';
    registry.updateMember(member.teamId, member.memberId, { status: 'idle' });
  }

  private async runLoop(): Promise<void> {
    const { member, transport, registry, emitEvent } = this.options;

    while (!this.shutdownRequested) {
      if (this.status === 'paused') {
        await this.waitForWake();
        if (this.shutdownRequested) {
          break;
        }
        if (this.status === 'paused') {
          continue;
        }
      }

      // Check for pending work without draining — messages are drained
      // by TeamContextMiddleware.drainInbox during session.invoke()
      const hasPending = transport.pendingCount(member.memberId) > 0;
      const hasClaimed = !!registry.getMember(member.memberId)?.currentJobId;

      if (!hasPending && !hasClaimed) {
        this.status = 'idle';
        registry.updateMember(member.teamId, member.memberId, { status: 'idle' });
        emitEvent({ type: 'member.idle', data: { teamId: member.teamId, memberId: member.memberId } });

        await this.waitForWake();
        if (this.shutdownRequested) break;
        continue;
      }

      // Process work — invoke session which drains inbox via middleware
      this.status = 'running';
      registry.updateMember(member.teamId, member.memberId, { status: 'working' });

      if (this.session) {
        try {
          const result = await this.invokeSession();
          if (result.reason === 'error') {
            await this.handleInvokeError(result.error ?? new Error('Agent loop error'));
            // Yield to event loop after error recovery — prevents tight loop when inbox isn't drained
            await new Promise(r => setTimeout(r, 0));
            continue;
          }
          if (result.reason === 'paused') {
            this.pauseMode = 'approval';
            this.status = 'paused';
            registry.updateMember(member.teamId, member.memberId, {status: 'paused'});
            emitEvent({
              type: 'member.paused',
              data: {
                teamId: member.teamId,
                memberId: member.memberId,
                ...(result.pause ? {pause: result.pause} : {}),
              },
            });
            continue;
          }
        } catch (err) {
          await this.handleInvokeError(err instanceof Error ? err : new Error(String(err)));
          await new Promise(r => setTimeout(r, 0));
          continue;
        }
      }
    }

    // Graceful shutdown
    this.status = 'terminated';
    registry.updateMember(member.teamId, member.memberId, { status: 'terminated' });
    emitEvent({
      type: 'member.left',
      data: { teamId: member.teamId, memberId: member.memberId, reason: 'shutdown' },
    });

    if (this.session) {
      await this.session.dispose();
    }
  }

  /**
   * Invoke the session, preferring stream() when available.
   * Stream mode lets the event loop process middleware events in real-time
   * instead of blocking until the entire agent turn completes.
   */
  private async invokeSession(): Promise<MemberInvokeResult> {
    if (this.session!.stream) {
      const gen = this.session!.stream();
      let iterResult: IteratorResult<unknown, MemberInvokeResult>;
      do {
        iterResult = await gen.next();
      } while (!iterResult.done);
      return iterResult.value;
    }
    return this.session!.invoke();
  }

  private async runApprovalResume(run: () => Promise<MemberInvokeResult>): Promise<MemberInvokeResult> {
    this.status = 'running';
    this.pauseMode = 'approval';
    this.options.registry.updateMember(this.options.member.teamId, this.options.member.memberId, {status: 'working'});
    const result = await run();
    this.applyPostResumeState(result);
    return result;
  }

  private async *runApprovalResumeStream(
    gen: AsyncGenerator<unknown, MemberInvokeResult, void>,
  ): AsyncGenerator<unknown, MemberInvokeResult, void> {
    this.status = 'running';
    this.pauseMode = 'approval';
    this.options.registry.updateMember(this.options.member.teamId, this.options.member.memberId, {status: 'working'});

    let result: IteratorResult<unknown, MemberInvokeResult>;
    do {
      result = await gen.next();
      if (!result.done) {
        yield result.value;
      }
    } while (!result.done);
    return result.value;
  }

  private applyPostResumeState(result: MemberInvokeResult): void {
    const {member, registry, emitEvent} = this.options;

    if (result.reason === 'error') {
      void this.handleInvokeError(result.error ?? new Error('Agent loop error'));
      return;
    }

    if (result.reason === 'paused') {
      this.pauseMode = 'approval';
      this.status = 'paused';
      registry.updateMember(member.teamId, member.memberId, {status: 'paused'});
      emitEvent({
        type: 'member.paused',
        data: {
          teamId: member.teamId,
          memberId: member.memberId,
          ...(result.pause ? {pause: result.pause} : {}),
        },
      });
      return;
    }

    this.pauseMode = undefined;
    this.status = 'idle';
    registry.updateMember(member.teamId, member.memberId, {status: 'idle'});
    this.wake();
  }

  /** Maximum idle wait before re-checking loop condition (prevents indefinite hangs). */
  static IDLE_POLL_MS = 30_000;

  private waitForWake(): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.wakeResolve = null;
        resolve();
      }, MemberRunner.IDLE_POLL_MS);
      this.wakeResolve = () => {
        clearTimeout(timer);
        resolve();
      };
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
        });
    }
  }
}

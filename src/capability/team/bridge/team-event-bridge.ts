import {randomUUID} from 'node:crypto';
import type {TeamBusEvent, TeamEventEmitter} from '@capability/team/events';
import type {CodaraRuntimeEvent} from '@engine/session/runtime-events';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface TeamEventBridgeOptions {
  sessionId: string;
  onRuntimeEvent: (event: CodaraRuntimeEvent) => void;
}

// ─── TeamEventBridge ──────────────────────────────────────────────────────────

/**
 * Bridges TeamEventEmitter events into the main agent's CodaraRuntimeEvent stream.
 *
 * Each team gets its own "root" event ID so the UI can pair start/end events.
 * Team events map to kind='team' runtime events, mirroring the 'task' kind pattern.
 */
export class TeamEventBridge {
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly teamRootIds = new Map<string, string>();

  constructor(private readonly options: TeamEventBridgeOptions) {}

  /** Start listening to a team's events and bridging them to runtime events. */
  attachTeam(teamId: string, emitter: TeamEventEmitter): void {
    if (this.unsubscribes.has(teamId)) {
      return; // already attached
    }
    const unsub = emitter.subscribe((event) => {
      const runtimeEvent = this.mapToRuntimeEvent(teamId, event);
      if (runtimeEvent) {
        this.options.onRuntimeEvent(runtimeEvent);
      }
    });
    this.unsubscribes.set(teamId, unsub);
  }

  /** Stop listening to a team's events. */
  detachTeam(teamId: string): void {
    this.unsubscribes.get(teamId)?.();
    this.unsubscribes.delete(teamId);
    this.teamRootIds.delete(teamId);
  }

  /** Detach all teams. */
  detachAll(): void {
    for (const teamId of [...this.unsubscribes.keys()]) {
      this.detachTeam(teamId);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private makeEvent(
    input: Omit<CodaraRuntimeEvent, 'id' | 'sessionId' | 'timestamp'> & {id?: string},
  ): CodaraRuntimeEvent {
    return {
      id: input.id ?? randomUUID(),
      sessionId: this.options.sessionId,
      timestamp: new Date().toISOString(),
      kind: input.kind,
      phase: input.phase,
      status: input.status,
      label: input.label,
      ...(input.detail ? {detail: input.detail} : {}),
      ...(input.parentId ? {parentId: input.parentId} : {}),
    };
  }

  private mapToRuntimeEvent(teamId: string, event: TeamBusEvent): CodaraRuntimeEvent | null {
    switch (event.type) {
      case 'team.running': {
        // Start event — create and remember a root ID for pairing
        const rootId = randomUUID();
        this.teamRootIds.set(teamId, rootId);
        return this.makeEvent({
          id: rootId,
          kind: 'team',
          phase: 'start',
          status: 'running',
          label: `Team ${teamId} started`,
          detail: teamId,
        });
      }

      case 'team.paused': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'paused',
          label: `Team ${teamId} paused`,
          detail: event.data.reason,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'team.completing': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'running',
          label: `Team ${teamId} completing`,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'team.completed': {
        const parentId = this.teamRootIds.get(teamId);
        const ev = this.makeEvent({
          kind: 'team',
          phase: 'end',
          status: 'done',
          label: `Team ${teamId} completed`,
          detail: event.data.summary || undefined,
          ...(parentId ? {parentId} : {}),
        });
        this.teamRootIds.delete(teamId);
        return ev;
      }

      case 'team.failed': {
        const parentId = this.teamRootIds.get(teamId);
        const ev = this.makeEvent({
          kind: 'team',
          phase: 'end',
          status: 'error',
          label: `Team ${teamId} failed`,
          detail: event.data.error || undefined,
          ...(parentId ? {parentId} : {}),
        });
        this.teamRootIds.delete(teamId);
        return ev;
      }

      case 'team.archived': {
        return null; // No UI representation needed
      }

      case 'member.joined': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'running',
          label: `${event.data.name} joined as ${event.data.role}`,
          detail: event.data.memberId,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'member.disconnected':
      case 'member.failed': {
        const parentId = this.teamRootIds.get(teamId);
        const reason = 'error' in event.data ? event.data.error : event.data.reason;
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Member ${event.data.memberId} ${event.type === 'member.failed' ? 'failed' : 'disconnected'}`,
          detail: reason || undefined,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'job.done': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'done',
          label: `Job ${event.data.jobId} completed`,
          detail: event.data.jobId,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'job.failed': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Job ${event.data.jobId} failed`,
          detail: event.data.error || undefined,
          ...(parentId ? {parentId} : {}),
        });
      }

      case 'team.budget.exceeded': {
        const parentId = this.teamRootIds.get(teamId);
        return this.makeEvent({
          kind: 'team',
          phase: 'update',
          status: 'error',
          label: `Team ${teamId} budget exceeded`,
          detail: `action: ${event.data.action}`,
          ...(parentId ? {parentId} : {}),
        });
      }

      default:
        // team.created, team.message, member.idle, member.working, member.paused,
        // member.left, job.created, job.ready, job.claimed, job.in_progress,
        // job.submitted, job.reviewed, team.budget.warning — no UI representation
        return null;
    }
  }
}

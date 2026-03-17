import {randomUUID} from 'node:crypto';
import type {TeamBusEvent, TeamEventEmitter} from '@capability/team/events';
import type {CodaraRuntimeEvent} from '@engine/session/runtime-events';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface TeamEventBridgeOptions {
  sessionId: string;
  onRuntimeEvent: (event: CodaraRuntimeEvent) => void;
}

// ─── TeamEventBridge ──────────────────────────────────────────────────────────

interface TeamMeta {
  name: string;
  goal: string;
  memberCount: number;
  jobTotal: number;
  jobDone: number;
}

/**
 * Bridges TeamEventEmitter events into the main agent's CodaraRuntimeEvent stream.
 *
 * Each team gets its own "root" event ID so the UI can pair start/end events.
 * Team events map to kind='team' runtime events, mirroring the 'task' kind pattern.
 */
export class TeamEventBridge {
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly teamRootIds = new Map<string, string>();
  private readonly teamMeta = new Map<string, TeamMeta>();

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
    this.teamMeta.delete(teamId);
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
      case 'team.created': {
        // Cache name/goal for use when team.running fires
        this.teamMeta.set(teamId, {
          name: event.data.name,
          goal: event.data.goal,
          memberCount: 0,
          jobTotal: 0,
          jobDone: 0,
        });
        return null; // No direct UI representation — rendered when team.running fires
      }

      case 'team.running': {
        // Start event — create and remember a root ID for pairing
        const rootId = randomUUID();
        this.teamRootIds.set(teamId, rootId);
        const meta = this.teamMeta.get(teamId);
        const name = meta?.name ?? teamId;
        const goal = meta?.goal ?? '';
        // label: "Team <name>: <goal>" for parsing in model.ts
        const label = goal ? `Team ${name}: ${goal}` : `Team ${name}`;
        return this.makeEvent({
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
        const meta = this.teamMeta.get(teamId);
        // detail format: "done:<n> total:<n> members:<n> summary:<text>"
        const donePart = `done:${meta?.jobDone ?? 0}`;
        const totalPart = `total:${meta?.jobTotal ?? 0}`;
        const membersPart = `members:${meta?.memberCount ?? 0}`;
        const summaryPart = event.data.summary ? `summary:${event.data.summary}` : '';
        const detailParts = [donePart, totalPart, membersPart, summaryPart].filter(Boolean);
        const ev = this.makeEvent({
          kind: 'team',
          phase: 'end',
          status: 'done',
          label: `Team ${teamId} completed`,
          detail: detailParts.join(' ') || undefined,
          ...(parentId ? {parentId} : {}),
        });
        this.teamRootIds.delete(teamId);
        return ev;
      }

      case 'team.failed': {
        const parentId = this.teamRootIds.get(teamId);
        const meta = this.teamMeta.get(teamId);
        // detail format: "done:<n> total:<n> error:<reason>"
        const donePart = `done:${meta?.jobDone ?? 0}`;
        const totalPart = `total:${meta?.jobTotal ?? 0}`;
        const errorPart = event.data.error ? `error:${event.data.error}` : '';
        const detailParts = [donePart, totalPart, errorPart].filter(Boolean);
        const ev = this.makeEvent({
          kind: 'team',
          phase: 'end',
          status: 'error',
          label: `Team ${teamId} failed`,
          detail: detailParts.join(' ') || undefined,
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
        const meta = this.teamMeta.get(teamId);
        if (meta) {
          meta.memberCount++;
        }
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
        const meta = this.teamMeta.get(teamId);
        if (meta) {
          meta.jobDone++;
        }
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

      default: {
        // Track job.created for total job count (used in end event stats)
        if (event.type === 'job.created') {
          const meta = this.teamMeta.get(teamId);
          if (meta) {
            meta.jobTotal++;
          }
        }
        // team.message, member.idle, member.working, member.paused,
        // member.left, job.ready, job.claimed, job.in_progress,
        // job.submitted, job.reviewed, team.budget.warning — no UI representation
        return null;
      }
    }
  }
}

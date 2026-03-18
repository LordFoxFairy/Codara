import type {TeamMessage} from './types.js';

// ── Team event type unions (for consumers) ──────────────────────────

export type TeamLifecycleEvent =
  | { type: 'team.created'; data: { teamId: string; name: string; goal: string; depth: number } }
  | { type: 'team.running'; data: { teamId: string } }
  | { type: 'team.paused'; data: { teamId: string; reason: string } }
  | { type: 'team.completing'; data: { teamId: string } }
  | { type: 'team.completed'; data: { teamId: string; summary: string } }
  | { type: 'team.failed'; data: { teamId: string; error: string } }
  | { type: 'team.archived'; data: { teamId: string } };

export type MemberLifecycleEvent =
  | { type: 'member.joined'; data: { teamId: string; memberId: string; name: string; role: string; mode: 'local' } }
  | { type: 'member.idle'; data: { teamId: string; memberId: string } }
  | { type: 'member.working'; data: { teamId: string; memberId: string; jobId: string } }
  | { type: 'member.paused'; data: { teamId: string; memberId: string; pause?: unknown } }
  | { type: 'member.disconnected'; data: { teamId: string; memberId: string; reason: string } }
  | { type: 'member.failed'; data: { teamId: string; memberId: string; error: string } }
  | { type: 'member.left'; data: { teamId: string; memberId: string; reason: string } };

export type JobLifecycleEvent =
  | { type: 'job.created'; data: { teamId: string; jobId: string; title: string; priority: number } }
  | { type: 'job.ready'; data: { teamId: string; jobId: string } }
  | { type: 'job.claimed'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.in_progress'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.submitted'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.reviewed'; data: { teamId: string; jobId: string; approved: boolean; reviewerId: string } }
  | { type: 'job.done'; data: { teamId: string; jobId: string } }
  | { type: 'job.failed'; data: { teamId: string; jobId: string; error: string } };

export type TeamMessageEvent = {
  type: 'team.message';
  data: { teamId: string; message: TeamMessage };
};

export type TeamBudgetEvent =
  | { type: 'team.budget.warning'; data: { teamId: string; usedPercent: number; remaining: number } }
  | { type: 'team.budget.exceeded'; data: { teamId: string; action: 'pause' | 'warn' | 'shutdown' } };

export type TeamHealthEvent =
  | { type: 'team.deadlock'; data: { teamId: string; message: string } };

export type TeamBusEvent =
  | TeamLifecycleEvent
  | MemberLifecycleEvent
  | JobLifecycleEvent
  | TeamMessageEvent
  | TeamBudgetEvent
  | TeamHealthEvent;

// ── TeamEventEmitter ────────────────────────────────────────────────

export class TeamEventEmitter {
  private listeners: Set<(event: TeamBusEvent) => void> = new Set();

  emit(event: TeamBusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* swallow — same policy as CodaraBus */
      }
    }
  }

  subscribe(listener: (event: TeamBusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ── Helper: isTeamEvent ─────────────────────────────────────────────

export function isTeamEvent(event: unknown): event is TeamBusEvent {
  if (typeof event !== 'object' || event === null || !('type' in event)) {
    return false;
  }
  const type = (event as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    return false;
  }
  return type.startsWith('team.') || type.startsWith('member.') || type.startsWith('job.');
}

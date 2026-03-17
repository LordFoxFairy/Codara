import type { TeamMessage } from '@capability/team/types';
import type { TeamTransport, Unsubscribe } from './types';

export class LocalTransport implements TeamTransport {
  private inboxes: Map<string, TeamMessage[]> = new Map();
  private subscribers: Map<string, Set<(msg: TeamMessage) => void>> = new Map();

  /** Register a member (create their inbox) */
  registerMember(memberId: string): void {
    if (!this.inboxes.has(memberId)) {
      this.inboxes.set(memberId, []);
      this.subscribers.set(memberId, new Set());
    }
  }

  async send(to: string | 'broadcast', message: TeamMessage): Promise<void> {
    if (to === 'broadcast') {
      for (const [memberId] of this.inboxes) {
        if (memberId !== message.from) {
          this.deliverTo(memberId, message);
        }
      }
    } else {
      if (!this.inboxes.has(to)) {
        throw new Error(`Unknown member: ${to}`);
      }
      this.deliverTo(to, message);
    }
  }

  private deliverTo(memberId: string, message: TeamMessage): void {
    this.inboxes.get(memberId)!.push(message);
    // Notify subscribers synchronously
    for (const handler of this.subscribers.get(memberId) ?? []) {
      handler(message);
    }
  }

  async receive(memberId: string): Promise<TeamMessage[]> {
    const inbox = this.inboxes.get(memberId) ?? [];
    this.inboxes.set(memberId, []); // drain
    return inbox;
  }

  pendingCount(memberId: string): number {
    return (this.inboxes.get(memberId) ?? []).length;
  }

  subscribe(memberId: string, handler: (msg: TeamMessage) => void): Unsubscribe {
    const subs = this.subscribers.get(memberId);
    if (!subs) {
      throw new Error(`Unknown member: ${memberId}`);
    }
    subs.add(handler);
    return () => subs.delete(handler);
  }

  isHealthy(memberId: string): boolean {
    return this.inboxes.has(memberId);
  }

  async close(memberId: string): Promise<void> {
    this.inboxes.delete(memberId);
    this.subscribers.delete(memberId);
  }
}

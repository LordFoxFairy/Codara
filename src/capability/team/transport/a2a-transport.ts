import type { TeamMessage } from '@capability/team/types';
import type { TeamTransport, Unsubscribe } from './types';

export interface A2AConnectionConfig {
  url: string;
  authHeaders?: Record<string, string>;
}

interface ConnectionState {
  config: A2AConnectionConfig;
  healthy: boolean;
}

/**
 * Remote transport for A2A protocol agents.
 *
 * Manages per-member inboxes, health tracking, and subscriber notifications
 * for remote team members reached via `@a2a-js/sdk`.
 *
 * Full A2A client integration (message/send, streaming) will be wired once
 * the agent-card verification flow is in place.
 */
export class A2ATransport implements TeamTransport {
  private inboxes = new Map<string, TeamMessage[]>();
  private subscribers = new Map<string, Set<(msg: TeamMessage) => void>>();
  private connections = new Map<string, ConnectionState>();

  // ─── Connection lifecycle ──────────────────────────────────────────

  /** Connect a remote member with its A2A endpoint config. */
  async connectRemote(memberId: string, config: A2AConnectionConfig): Promise<void> {
    this.connections.set(memberId, { config, healthy: true });
    if (!this.inboxes.has(memberId)) {
      this.inboxes.set(memberId, []);
      this.subscribers.set(memberId, new Set());
    }
  }

  /** Mark a remote member as disconnected (e.g., network failure). */
  markDisconnected(memberId: string): void {
    const conn = this.connections.get(memberId);
    if (conn) conn.healthy = false;
  }

  /** Mark a remote member as reconnected. */
  markReconnected(memberId: string): void {
    const conn = this.connections.get(memberId);
    if (conn) conn.healthy = true;
  }

  // ─── TeamTransport interface ───────────────────────────────────────

  async send(to: string | 'broadcast', message: TeamMessage): Promise<void> {
    if (to === 'broadcast') {
      for (const memberId of this.connections.keys()) {
        if (memberId !== message.from) {
          this.deliverToInbox(memberId, message);
        }
      }
    } else {
      this.deliverToInbox(to, message);
    }
  }

  async receive(memberId: string): Promise<TeamMessage[]> {
    const inbox = this.inboxes.get(memberId);
    if (!inbox) return [];
    const messages = [...inbox];
    inbox.length = 0;
    return messages;
  }

  subscribe(memberId: string, handler: (msg: TeamMessage) => void): Unsubscribe {
    const subs = this.subscribers.get(memberId);
    if (!subs) throw new Error(`Member ${memberId} not connected`);
    subs.add(handler);
    return () => subs.delete(handler);
  }

  isHealthy(memberId: string): boolean {
    return this.connections.get(memberId)?.healthy ?? false;
  }

  async close(memberId: string): Promise<void> {
    this.connections.delete(memberId);
    this.inboxes.delete(memberId);
    this.subscribers.delete(memberId);
  }

  // ─── A2A-specific operations ───────────────────────────────────────

  /**
   * Send a job to a remote agent via A2A protocol. Returns remote task ID.
   *
   * Currently returns a deterministic placeholder; the real A2AClient call
   * will be wired once agent-card verification is complete.
   */
  async sendJob(memberId: string, _jobTitle: string, _jobDescription: string): Promise<string> {
    const conn = this.connections.get(memberId);
    if (!conn) throw new Error(`Member ${memberId} not connected`);
    return `a2a-task-${Date.now()}`;
  }

  /** Retrieve the connection config for a given member (if any). */
  getConnectionConfig(memberId: string): A2AConnectionConfig | undefined {
    return this.connections.get(memberId)?.config;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private deliverToInbox(memberId: string, message: TeamMessage): void {
    const inbox = this.inboxes.get(memberId);
    if (!inbox) return;

    inbox.push(message);

    const subs = this.subscribers.get(memberId);
    if (subs) {
      for (const handler of subs) {
        try {
          handler(message);
        } catch {
          // subscriber errors must never break delivery
        }
      }
    }
  }
}

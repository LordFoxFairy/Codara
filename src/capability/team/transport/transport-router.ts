import type { TeamMessage } from '@capability/team/types';
import type { TeamTransport, Unsubscribe } from './types';
import { LocalTransport } from './local-transport';

export class TransportRouter implements TeamTransport {
  private local: LocalTransport;
  private remote?: TeamTransport; // A2ATransport injected later
  private routes: Map<string, 'local' | 'remote'> = new Map();

  constructor(local?: LocalTransport, remote?: TeamTransport) {
    this.local = local ?? new LocalTransport();
    this.remote = remote;
  }

  /** Register a member with their transport mode */
  registerRoute(memberId: string, mode: 'local' | 'remote'): void {
    this.routes.set(memberId, mode);
    if (mode === 'local') {
      this.local.registerMember(memberId);
    }
  }

  /** Remove a member's route */
  removeRoute(memberId: string): void {
    this.routes.delete(memberId);
  }

  async send(to: string | 'broadcast', message: TeamMessage): Promise<void> {
    if (to === 'broadcast') {
      // Send to all local members via local transport broadcast
      await this.local.send('broadcast', message);
      // Send to each remote member individually
      if (this.remote) {
        for (const [memberId, mode] of this.routes) {
          if (mode === 'remote' && memberId !== message.from) {
            await this.remote.send(memberId, message);
          }
        }
      }
    } else {
      const route = this.routes.get(to);
      if (!route) throw new Error(`No route for member: ${to}`);
      if (route === 'remote') {
        if (!this.remote) throw new Error('No remote transport configured');
        await this.remote.send(to, message);
      } else {
        await this.local.send(to, message);
      }
    }
  }

  async receive(memberId: string): Promise<TeamMessage[]> {
    const route = this.routes.get(memberId);
    if (!route) return [];
    if (route === 'remote' && this.remote) {
      return this.remote.receive(memberId);
    }
    return this.local.receive(memberId);
  }

  subscribe(memberId: string, handler: (msg: TeamMessage) => void): Unsubscribe {
    const route = this.routes.get(memberId);
    if (route === 'remote' && this.remote) {
      return this.remote.subscribe(memberId, handler);
    }
    return this.local.subscribe(memberId, handler);
  }

  isHealthy(memberId: string): boolean {
    const route = this.routes.get(memberId);
    if (!route) return false;
    if (route === 'remote') {
      return this.remote?.isHealthy(memberId) ?? false;
    }
    return this.local.isHealthy(memberId);
  }

  async close(memberId: string): Promise<void> {
    const route = this.routes.get(memberId);
    if (route === 'remote' && this.remote) {
      await this.remote.close(memberId);
    } else {
      await this.local.close(memberId);
    }
    this.routes.delete(memberId);
  }

  /** Get the underlying local transport */
  getLocal(): LocalTransport {
    return this.local;
  }
}

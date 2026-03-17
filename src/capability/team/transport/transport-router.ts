import type { TeamMessage } from '@capability/team/types';
import type { TeamTransport, Unsubscribe } from './types';
import { LocalTransport } from './local-transport';

/**
 * Thin pass-through to LocalTransport.
 *
 * All team members are local (intra-process). There is no remote routing at
 * the team level — cross-instance communication happens via A2ATransport at
 * the instance level, not here.
 */
export class TransportRouter implements TeamTransport {
  private local: LocalTransport;

  constructor(local?: LocalTransport) {
    this.local = local ?? new LocalTransport();
  }

  /** Register a member (create their inbox in the local transport). */
  registerRoute(memberId: string): void {
    this.local.registerMember(memberId);
  }

  /** Remove a member's inbox. */
  removeRoute(memberId: string): Promise<void> {
    return this.local.close(memberId);
  }

  async send(to: string | 'broadcast', message: TeamMessage): Promise<void> {
    return this.local.send(to, message);
  }

  async receive(memberId: string): Promise<TeamMessage[]> {
    return this.local.receive(memberId);
  }

  pendingCount(memberId: string): number {
    return this.local.pendingCount(memberId);
  }

  subscribe(memberId: string, handler: (msg: TeamMessage) => void): Unsubscribe {
    return this.local.subscribe(memberId, handler);
  }

  isHealthy(memberId: string): boolean {
    return this.local.isHealthy(memberId);
  }

  async close(memberId: string): Promise<void> {
    return this.local.close(memberId);
  }

  /** Get the underlying local transport (e.g. for direct member registration). */
  getLocal(): LocalTransport {
    return this.local;
  }
}

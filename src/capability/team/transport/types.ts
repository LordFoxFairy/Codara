import type { TeamMessage } from '@capability/team/types';

export type Unsubscribe = () => void;

export interface TeamTransport {
  /** Send a message to a specific member or broadcast to all */
  send(to: string | 'broadcast', message: TeamMessage): Promise<void>;
  /** Pull pending messages for a member (drains inbox) */
  receive(memberId: string): Promise<TeamMessage[]>;
  /** Check how many messages are pending without draining */
  pendingCount(memberId: string): number;
  /** Subscribe to real-time message events for a member */
  subscribe(memberId: string, handler: (msg: TeamMessage) => void): Unsubscribe;
  /** Check if the transport is healthy for a member */
  isHealthy(memberId: string): boolean;
  /** Gracefully close connection for a member */
  close(memberId: string): Promise<void>;
}

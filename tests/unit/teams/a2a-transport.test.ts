import { describe, it, expect, beforeEach } from 'bun:test';
import { A2ATransport } from '@capability/team/transport/a2a-transport';
import type { TeamMessage } from '@capability/team/types';

function makeMessage(from: string, to: string | 'broadcast', content = 'test'): TeamMessage {
  return {
    id: crypto.randomUUID(),
    from,
    to,
    teamId: 'team_1',
    type: 'message',
    content,
    timestamp: new Date().toISOString(),
    read: false,
  };
}

describe('A2ATransport', () => {
  let transport: A2ATransport;

  beforeEach(() => {
    transport = new A2ATransport();
  });

  // ─── connectRemote ─────────────────────────────────────────────────

  describe('connectRemote', () => {
    it('registers a member as healthy', async () => {
      await transport.connectRemote('agent-1', { url: 'http://localhost:3000' });
      expect(transport.isHealthy('agent-1')).toBe(true);
    });

    it('preserves inbox on re-connect', async () => {
      await transport.connectRemote('agent-1', { url: 'http://localhost:3000' });
      await transport.send('agent-1', makeMessage('leader', 'agent-1'));
      // reconnect with new url
      await transport.connectRemote('agent-1', { url: 'http://localhost:4000' });
      const inbox = await transport.receive('agent-1');
      expect(inbox).toHaveLength(1);
    });

    it('stores connection config', async () => {
      const config = { url: 'http://remote:8080', authHeaders: { Authorization: 'Bearer x' } };
      await transport.connectRemote('agent-1', config);
      expect(transport.getConnectionConfig('agent-1')).toEqual(config);
    });
  });

  // ─── send (direct) ────────────────────────────────────────────────

  describe('send (direct)', () => {
    it('delivers message to recipient inbox', async () => {
      await transport.connectRemote('agent-1', { url: 'http://localhost:3000' });
      const msg = makeMessage('leader', 'agent-1');
      await transport.send('agent-1', msg);
      const inbox = await transport.receive('agent-1');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });

    it('silently drops messages to unknown members', async () => {
      const msg = makeMessage('leader', 'ghost');
      // Should not throw — remote members may disconnect at any time
      await transport.send('ghost', msg);
    });
  });

  // ─── send (broadcast) ─────────────────────────────────────────────

  describe('send (broadcast)', () => {
    it('delivers to all connected members except sender', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      await transport.connectRemote('agent-2', { url: 'http://a:2' });
      await transport.connectRemote('leader', { url: 'http://a:3' });

      const msg = makeMessage('leader', 'broadcast');
      await transport.send('broadcast', msg);

      const inbox1 = await transport.receive('agent-1');
      const inbox2 = await transport.receive('agent-2');
      const leaderInbox = await transport.receive('leader');

      expect(inbox1).toHaveLength(1);
      expect(inbox2).toHaveLength(1);
      expect(leaderInbox).toHaveLength(0); // sender excluded
    });
  });

  // ─── receive ──────────────────────────────────────────────────────

  describe('receive', () => {
    it('drains the inbox', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      await transport.send('agent-1', makeMessage('leader', 'agent-1', 'first'));
      await transport.send('agent-1', makeMessage('leader', 'agent-1', 'second'));

      const first = await transport.receive('agent-1');
      expect(first).toHaveLength(2);

      const second = await transport.receive('agent-1');
      expect(second).toHaveLength(0);
    });

    it('returns empty array for unknown member', async () => {
      const inbox = await transport.receive('nobody');
      expect(inbox).toEqual([]);
    });
  });

  // ─── subscribe ────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('receives new messages in real time', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      const received: TeamMessage[] = [];
      transport.subscribe('agent-1', msg => received.push(msg));

      const msg = makeMessage('leader', 'agent-1');
      await transport.send('agent-1', msg);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(msg);
    });

    it('stops receiving after unsubscribe', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      const received: TeamMessage[] = [];
      const unsub = transport.subscribe('agent-1', msg => received.push(msg));

      await transport.send('agent-1', makeMessage('leader', 'agent-1', 'before'));
      expect(received).toHaveLength(1);

      unsub();
      await transport.send('agent-1', makeMessage('leader', 'agent-1', 'after'));
      expect(received).toHaveLength(1); // unchanged
    });

    it('throws for unconnected member', () => {
      expect(() => transport.subscribe('ghost', () => {})).toThrow('Member ghost not connected');
    });

    it('error in one subscriber does not affect others', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      const received: string[] = [];

      transport.subscribe('agent-1', () => {
        throw new Error('boom');
      });
      transport.subscribe('agent-1', msg => received.push(msg.content));

      await transport.send('agent-1', makeMessage('leader', 'agent-1', 'hello'));
      expect(received).toEqual(['hello']);
    });
  });

  // ─── isHealthy ────────────────────────────────────────────────────

  describe('isHealthy', () => {
    it('returns true for connected member', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      expect(transport.isHealthy('agent-1')).toBe(true);
    });

    it('returns false for non-existent member', () => {
      expect(transport.isHealthy('nobody')).toBe(false);
    });
  });

  // ─── markDisconnected / markReconnected ───────────────────────────

  describe('health toggling', () => {
    it('markDisconnected sets healthy to false', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      transport.markDisconnected('agent-1');
      expect(transport.isHealthy('agent-1')).toBe(false);
    });

    it('markReconnected restores healthy to true', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      transport.markDisconnected('agent-1');
      transport.markReconnected('agent-1');
      expect(transport.isHealthy('agent-1')).toBe(true);
    });

    it('markDisconnected on unknown member is a no-op', () => {
      // Should not throw
      transport.markDisconnected('nobody');
      expect(transport.isHealthy('nobody')).toBe(false);
    });
  });

  // ─── close ────────────────────────────────────────────────────────

  describe('close', () => {
    it('removes all state for the member', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      await transport.send('agent-1', makeMessage('leader', 'agent-1'));

      await transport.close('agent-1');

      expect(transport.isHealthy('agent-1')).toBe(false);
      expect(transport.getConnectionConfig('agent-1')).toBeUndefined();

      const inbox = await transport.receive('agent-1');
      expect(inbox).toEqual([]);
    });

    it('removes subscribers on close', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      const received: TeamMessage[] = [];
      transport.subscribe('agent-1', msg => received.push(msg));

      await transport.close('agent-1');

      // Re-connect and send — old subscriber must NOT fire
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      await transport.send('agent-1', makeMessage('leader', 'agent-1'));
      expect(received).toHaveLength(0);
    });
  });

  // ─── sendJob ──────────────────────────────────────────────────────

  describe('sendJob', () => {
    it('returns a task ID for connected member', async () => {
      await transport.connectRemote('agent-1', { url: 'http://a:1' });
      const taskId = await transport.sendJob('agent-1', 'Implement feature', 'Build the thing');
      expect(taskId).toMatch(/^a2a-task-\d+$/);
    });

    it('throws for unconnected member', async () => {
      await expect(
        transport.sendJob('ghost', 'title', 'desc'),
      ).rejects.toThrow('Member ghost not connected');
    });
  });
});

import { describe, it, expect, beforeEach } from 'bun:test';
import { LocalTransport } from '@capability/team/transport/local-transport';
import type { TeamMessage } from '@capability/team/coordination/types';

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

describe('LocalTransport', () => {
  let transport: LocalTransport;

  beforeEach(() => {
    transport = new LocalTransport();
  });

  describe('registerMember', () => {
    it('creates inbox for a new member', () => {
      transport.registerMember('alice');
      expect(transport.isHealthy('alice')).toBe(true);
    });

    it('is idempotent — registering twice does not reset inbox', async () => {
      transport.registerMember('alice');
      const msg = makeMessage('bob', 'alice');
      await transport.send('alice', msg);
      transport.registerMember('alice'); // second registration
      const inbox = await transport.receive('alice');
      expect(inbox).toHaveLength(1);
    });
  });

  describe('send (direct)', () => {
    it('delivers message to recipient inbox', async () => {
      transport.registerMember('alice');
      const msg = makeMessage('bob', 'alice');
      await transport.send('alice', msg);
      const inbox = await transport.receive('alice');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });

    it('throws for unknown recipient', async () => {
      const msg = makeMessage('alice', 'unknown');
      await expect(transport.send('unknown', msg)).rejects.toThrow('Unknown member: unknown');
    });
  });

  describe('send (broadcast)', () => {
    it('delivers to all members except sender', async () => {
      transport.registerMember('alice');
      transport.registerMember('bob');
      transport.registerMember('carol');

      const msg = makeMessage('alice', 'broadcast');
      await transport.send('broadcast', msg);

      const bobInbox = await transport.receive('bob');
      const carolInbox = await transport.receive('carol');
      const aliceInbox = await transport.receive('alice');

      expect(bobInbox).toHaveLength(1);
      expect(carolInbox).toHaveLength(1);
      expect(aliceInbox).toHaveLength(0); // sender excluded
    });

    it('broadcast skips sender — sender does not receive own broadcast', async () => {
      transport.registerMember('alice');
      transport.registerMember('bob');

      const msg = makeMessage('alice', 'broadcast');
      await transport.send('broadcast', msg);

      const aliceInbox = await transport.receive('alice');
      expect(aliceInbox).toHaveLength(0);
    });
  });

  describe('receive', () => {
    it('returns messages and drains inbox', async () => {
      transport.registerMember('alice');
      const msg1 = makeMessage('bob', 'alice', 'first');
      const msg2 = makeMessage('carol', 'alice', 'second');
      await transport.send('alice', msg1);
      await transport.send('alice', msg2);

      const inbox = await transport.receive('alice');
      expect(inbox).toHaveLength(2);
      expect(inbox[0]).toBe(msg1);
      expect(inbox[1]).toBe(msg2);
    });

    it('returns empty array for empty inbox', async () => {
      transport.registerMember('alice');
      const inbox = await transport.receive('alice');
      expect(inbox).toEqual([]);
    });

    it('returns empty array after drain', async () => {
      transport.registerMember('alice');
      await transport.send('alice', makeMessage('bob', 'alice'));
      await transport.receive('alice'); // first drain
      const inbox = await transport.receive('alice'); // second call
      expect(inbox).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('handler is called synchronously on message arrival', async () => {
      transport.registerMember('alice');
      const received: TeamMessage[] = [];
      transport.subscribe('alice', msg => received.push(msg));

      const msg = makeMessage('bob', 'alice');
      await transport.send('alice', msg);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(msg);
    });

    it('handler is NOT called after unsubscribe', async () => {
      transport.registerMember('alice');
      const received: TeamMessage[] = [];
      const unsubscribe = transport.subscribe('alice', msg => received.push(msg));

      const msg1 = makeMessage('bob', 'alice', 'before');
      await transport.send('alice', msg1);
      expect(received).toHaveLength(1);

      unsubscribe();

      const msg2 = makeMessage('bob', 'alice', 'after');
      await transport.send('alice', msg2);
      expect(received).toHaveLength(1); // still 1, handler not called again
    });

    it('throws for unknown member', () => {
      expect(() => transport.subscribe('ghost', () => {})).toThrow('Unknown member: ghost');
    });
  });

  describe('isHealthy', () => {
    it('returns true for registered member', () => {
      transport.registerMember('alice');
      expect(transport.isHealthy('alice')).toBe(true);
    });

    it('returns false for unregistered member', () => {
      expect(transport.isHealthy('nobody')).toBe(false);
    });
  });

  describe('close', () => {
    it('removes inbox and marks member as unhealthy', async () => {
      transport.registerMember('alice');
      await transport.close('alice');
      expect(transport.isHealthy('alice')).toBe(false);
    });

    it('removes subscribers on close', async () => {
      transport.registerMember('alice');
      const received: TeamMessage[] = [];
      transport.subscribe('alice', msg => received.push(msg));
      await transport.close('alice');

      // Re-register and send — old subscriber must NOT fire
      transport.registerMember('alice');
      await transport.send('alice', makeMessage('bob', 'alice'));
      expect(received).toHaveLength(0);
    });
  });

  describe('multiple messages', () => {
    it('preserves insertion order', async () => {
      transport.registerMember('alice');
      const contents = ['first', 'second', 'third', 'fourth', 'fifth'];
      for (const c of contents) {
        await transport.send('alice', makeMessage('bob', 'alice', c));
      }
      const inbox = await transport.receive('alice');
      expect(inbox.map(m => m.content)).toEqual(contents);
    });
  });
});

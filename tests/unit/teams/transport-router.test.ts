import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TransportRouter } from '@capability/team/transport/transport-router';
import { LocalTransport } from '@capability/team/transport/local-transport';
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

describe('TransportRouter', () => {
  let local: LocalTransport;
  let router: TransportRouter;

  beforeEach(() => {
    local = new LocalTransport();
    router = new TransportRouter(local);
  });

  describe('registerRoute', () => {
    it('delegates to LocalTransport.registerMember', () => {
      router.registerRoute('m1');
      expect(local.isHealthy('m1')).toBe(true);
    });

    it('registers multiple members independently', () => {
      router.registerRoute('m1');
      router.registerRoute('m2');
      expect(local.isHealthy('m1')).toBe(true);
      expect(local.isHealthy('m2')).toBe(true);
    });
  });

  describe('send', () => {
    it('delegates to LocalTransport.send for a direct member', async () => {
      router.registerRoute('m1');
      const msg = makeMessage('sender', 'm1');
      await router.send('m1', msg);
      const inbox = await local.receive('m1');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });

    it('delegates broadcast to LocalTransport.send', async () => {
      router.registerRoute('m1');
      router.registerRoute('m2');
      const msg = makeMessage('sender', 'broadcast');
      await router.send('broadcast', msg);
      const m1Inbox = await local.receive('m1');
      const m2Inbox = await local.receive('m2');
      expect(m1Inbox).toHaveLength(1);
      expect(m2Inbox).toHaveLength(1);
    });

    it('broadcast excludes the sender', async () => {
      router.registerRoute('m1');
      router.registerRoute('m2');
      const msg = makeMessage('m1', 'broadcast');
      await router.send('broadcast', msg);
      const m1Inbox = await local.receive('m1');
      const m2Inbox = await local.receive('m2');
      expect(m1Inbox).toHaveLength(0);
      expect(m2Inbox).toHaveLength(1);
    });
  });

  describe('receive', () => {
    it('delegates to LocalTransport.receive', async () => {
      router.registerRoute('m1');
      const msg = makeMessage('sender', 'm1');
      await local.send('m1', msg);
      const inbox = await router.receive('m1');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });

    it('drains the inbox on receive', async () => {
      router.registerRoute('m1');
      const msg = makeMessage('sender', 'm1');
      await local.send('m1', msg);
      await router.receive('m1');
      const second = await router.receive('m1');
      expect(second).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('delegates to LocalTransport.subscribe', async () => {
      router.registerRoute('m1');
      const received: TeamMessage[] = [];
      const unsub = router.subscribe('m1', msg => received.push(msg));
      const msg = makeMessage('sender', 'm1');
      await local.send('m1', msg);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(msg);
      unsub();
    });

    it('returns an unsubscribe function that stops delivery', async () => {
      router.registerRoute('m1');
      const received: TeamMessage[] = [];
      const unsub = router.subscribe('m1', msg => received.push(msg));
      unsub();
      await local.send('m1', makeMessage('sender', 'm1'));
      expect(received).toHaveLength(0);
    });
  });

  describe('isHealthy', () => {
    it('delegates to LocalTransport.isHealthy — true for registered member', () => {
      router.registerRoute('m1');
      expect(router.isHealthy('m1')).toBe(true);
    });

    it('delegates to LocalTransport.isHealthy — false for unregistered member', () => {
      expect(router.isHealthy('nobody')).toBe(false);
    });

    it('returns false after close', async () => {
      router.registerRoute('m1');
      await router.close('m1');
      expect(router.isHealthy('m1')).toBe(false);
    });
  });

  describe('close', () => {
    it('delegates to LocalTransport.close', async () => {
      router.registerRoute('m1');
      await router.close('m1');
      expect(local.isHealthy('m1')).toBe(false);
    });

    it('inbox is gone after close', async () => {
      router.registerRoute('m1');
      const msg = makeMessage('sender', 'm1');
      await local.send('m1', msg);
      await router.close('m1');
      const inbox = await router.receive('m1');
      expect(inbox).toEqual([]);
    });

    it('removeRoute also delegates to LocalTransport.close', async () => {
      router.registerRoute('m1');
      await router.removeRoute('m1');
      expect(local.isHealthy('m1')).toBe(false);
    });
  });

  describe('getLocal', () => {
    it('returns the underlying LocalTransport instance', () => {
      expect(router.getLocal()).toBe(local);
    });
  });
});

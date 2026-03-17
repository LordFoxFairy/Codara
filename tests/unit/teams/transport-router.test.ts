import { describe, it, expect, beforeEach } from 'bun:test';
import { TransportRouter } from '@capability/team/transport/transport-router';
import { LocalTransport } from '@capability/team/transport/local-transport';
import type { TeamTransport, Unsubscribe } from '@capability/team/transport/types';
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

class MockRemoteTransport implements TeamTransport {
  sent: { to: string; message: TeamMessage }[] = [];
  inbox: Map<string, TeamMessage[]> = new Map();

  async send(to: string, message: TeamMessage) {
    this.sent.push({ to: to as string, message });
  }

  async receive(memberId: string) {
    const msgs = this.inbox.get(memberId) ?? [];
    this.inbox.set(memberId, []);
    return msgs;
  }

  subscribe(): Unsubscribe {
    return () => {};
  }

  isHealthy(memberId: string) {
    return this.inbox.has(memberId);
  }

  async close() {}
}

describe('TransportRouter', () => {
  let router: TransportRouter;
  let mockRemote: MockRemoteTransport;

  beforeEach(() => {
    mockRemote = new MockRemoteTransport();
    router = new TransportRouter(undefined, mockRemote);
  });

  describe('local routing', () => {
    it('send/receive goes through LocalTransport for local members', async () => {
      router.registerRoute('m1', 'local');
      const msg = makeMessage('sender', 'm1');
      await router.send('m1', msg);
      const inbox = await router.receive('m1');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });

    it('registers member in LocalTransport on registerRoute local', () => {
      router.registerRoute('m1', 'local');
      expect(router.getLocal().isHealthy('m1')).toBe(true);
    });
  });

  describe('remote routing', () => {
    it('send goes through mock remote transport for remote members', async () => {
      router.registerRoute('m2', 'remote');
      const msg = makeMessage('sender', 'm2');
      await router.send('m2', msg);
      expect(mockRemote.sent).toHaveLength(1);
      expect(mockRemote.sent[0].to).toBe('m2');
      expect(mockRemote.sent[0].message).toBe(msg);
    });

    it('receive goes through mock remote transport for remote members', async () => {
      router.registerRoute('m2', 'remote');
      const msg = makeMessage('sender', 'm2');
      mockRemote.inbox.set('m2', [msg]);
      const inbox = await router.receive('m2');
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toBe(msg);
    });
  });

  describe('broadcast', () => {
    it('reaches both local and remote members', async () => {
      router.registerRoute('local1', 'local');
      router.registerRoute('local2', 'local');
      router.registerRoute('remote1', 'remote');

      const msg = makeMessage('sender', 'broadcast');
      await router.send('broadcast', msg);

      // Local members receive via LocalTransport
      const local1Inbox = await router.receive('local1');
      const local2Inbox = await router.receive('local2');
      expect(local1Inbox).toHaveLength(1);
      expect(local2Inbox).toHaveLength(1);

      // Remote member receives individually via remote transport
      expect(mockRemote.sent).toHaveLength(1);
      expect(mockRemote.sent[0].to).toBe('remote1');
    });

    it('broadcast does not send to sender (remote)', async () => {
      router.registerRoute('remote1', 'remote');
      const msg = makeMessage('remote1', 'broadcast');
      await router.send('broadcast', msg);
      expect(mockRemote.sent).toHaveLength(0);
    });

    it('broadcast does not send to sender (local)', async () => {
      router.registerRoute('local1', 'local');
      router.registerRoute('local2', 'local');
      const msg = makeMessage('local1', 'broadcast');
      await router.send('broadcast', msg);
      const local1Inbox = await router.receive('local1');
      expect(local1Inbox).toHaveLength(0); // sender excluded
    });
  });

  describe('error cases', () => {
    it('send to unknown member throws', async () => {
      const msg = makeMessage('sender', 'unknown');
      await expect(router.send('unknown', msg)).rejects.toThrow('No route for member: unknown');
    });

    it('send to remote member without remote transport throws', async () => {
      const routerNoRemote = new TransportRouter();
      routerNoRemote.registerRoute('m2', 'remote');
      const msg = makeMessage('sender', 'm2');
      await expect(routerNoRemote.send('m2', msg)).rejects.toThrow('No remote transport configured');
    });
  });

  describe('isHealthy', () => {
    it('delegates to LocalTransport for local member', () => {
      router.registerRoute('m1', 'local');
      expect(router.isHealthy('m1')).toBe(true);
    });

    it('delegates to remote transport for remote member', () => {
      router.registerRoute('m2', 'remote');
      mockRemote.inbox.set('m2', []);
      expect(router.isHealthy('m2')).toBe(true);
    });

    it('returns false for remote member when remote transport says unhealthy', () => {
      router.registerRoute('m2', 'remote');
      // mockRemote.inbox does not have 'm2', so isHealthy returns false
      expect(router.isHealthy('m2')).toBe(false);
    });

    it('returns false for unrouted member', () => {
      expect(router.isHealthy('nobody')).toBe(false);
    });

    it('returns false for remote member when no remote transport configured', () => {
      const routerNoRemote = new TransportRouter();
      routerNoRemote.registerRoute('m2', 'remote');
      expect(routerNoRemote.isHealthy('m2')).toBe(false);
    });
  });

  describe('close', () => {
    it('removes route for local member after close', async () => {
      router.registerRoute('m1', 'local');
      await router.close('m1');
      expect(router.isHealthy('m1')).toBe(false);
    });

    it('delegates close to remote transport for remote member', async () => {
      let closed = '';
      const trackingRemote: TeamTransport = {
        async send() {},
        async receive() { return []; },
        subscribe() { return () => {}; },
        isHealthy() { return false; },
        async close(memberId: string) { closed = memberId; },
      };
      const r = new TransportRouter(undefined, trackingRemote);
      r.registerRoute('m2', 'remote');
      await r.close('m2');
      expect(closed).toBe('m2');
      expect(r.isHealthy('m2')).toBe(false);
    });

    it('route is removed after close', async () => {
      router.registerRoute('m1', 'local');
      await router.close('m1');
      // After close, receiving returns [] (unrouted)
      const inbox = await router.receive('m1');
      expect(inbox).toEqual([]);
    });
  });

  describe('receive from unrouted member', () => {
    it('returns empty array', async () => {
      const inbox = await router.receive('nobody');
      expect(inbox).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('delegates to LocalTransport for local member', async () => {
      router.registerRoute('m1', 'local');
      const received: TeamMessage[] = [];
      router.subscribe('m1', msg => received.push(msg));
      await router.send('m1', makeMessage('sender', 'm1'));
      expect(received).toHaveLength(1);
    });

    it('delegates to remote transport for remote member', () => {
      let subscribedTo = '';
      const trackingRemote: TeamTransport = {
        async send() {},
        async receive() { return []; },
        subscribe(memberId: string) { subscribedTo = memberId; return () => {}; },
        isHealthy() { return false; },
        async close() {},
      };
      const r = new TransportRouter(undefined, trackingRemote);
      r.registerRoute('m2', 'remote');
      r.subscribe('m2', () => {});
      expect(subscribedTo).toBe('m2');
    });
  });

  describe('removeRoute', () => {
    it('removes a route without closing the underlying transport', () => {
      router.registerRoute('m1', 'local');
      router.removeRoute('m1');
      expect(router.isHealthy('m1')).toBe(false);
      // Underlying LocalTransport still has the member
      expect(router.getLocal().isHealthy('m1')).toBe(true);
    });
  });
});

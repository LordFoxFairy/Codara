import {describe, test, expect} from 'bun:test';
import {createGatewaySessionManager} from '@gateway/session-manager';
import type {GatewaySession} from '@gateway/session-manager';
import type {InboundMessage} from '@gateway/types';
import {tmpdir} from 'node:os';
import path from 'node:path';

function createMockSession(key: string): GatewaySession & {disposed: boolean; key: string} {
  return {
    key,
    disposed: false,
    async invoke(text: string) {
      return `echo: ${text}`;
    },
    async *stream(text: string) {
      yield text;
      return text;
    },
    async dispose() {
      this.disposed = true;
    },
  };
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'bot1',
    messageId: 'msg1',
    sender: {id: 'user1', name: 'Alice'},
    peer: {kind: 'direct', id: 'user1'},
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function tmpPersistDir(): string {
  return path.join(tmpdir(), `codara-sm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('GatewaySessionManager', () => {
  test('getOrCreate creates a new session and returns sessionKey', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    const {session, sessionKey} = await mgr.getOrCreate(makeMsg());
    expect(session).toBeDefined();
    expect(sessionKey).toBe('codara:telegram:direct:user1');
    expect(mgr.activeCount()).toBe(1);
  });

  test('getOrCreate returns existing session for same message', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    const {session: s1} = await mgr.getOrCreate(makeMsg());
    const {session: s2} = await mgr.getOrCreate(makeMsg());
    expect(s1).toBe(s2);
    expect(mgr.activeCount()).toBe(1);
  });

  test('get returns undefined for missing key', () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    expect(mgr.get('missing')).toBeUndefined();
  });

  test('get returns existing session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    const {session, sessionKey} = await mgr.getOrCreate(makeMsg());
    expect(mgr.get(sessionKey)).toBe(session);
  });

  test('remove disposes and deletes session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    const {session, sessionKey} = await mgr.getOrCreate(makeMsg());
    const mockSession = session as ReturnType<typeof createMockSession>;
    await mgr.remove(sessionKey);
    expect(mockSession.disposed).toBe(true);
    expect(mgr.get(sessionKey)).toBeUndefined();
    expect(mgr.activeCount()).toBe(0);
  });

  test('evicts oldest session when maxSessions reached', async () => {
    const created: ReturnType<typeof createMockSession>[] = [];
    const mgr = createGatewaySessionManager({
      createSession: async (key) => {
        const s = createMockSession(key);
        created.push(s);
        return s;
      },
      sessionConfig: {maxSessions: 2, persistDir: tmpPersistDir()},
    });

    await mgr.getOrCreate(makeMsg({sender: {id: 'u1'}, peer: {kind: 'direct', id: 'u1'}}));
    await mgr.getOrCreate(makeMsg({sender: {id: 'u2'}, peer: {kind: 'direct', id: 'u2'}}));
    expect(mgr.activeCount()).toBe(2);

    await mgr.getOrCreate(makeMsg({sender: {id: 'u3'}, peer: {kind: 'direct', id: 'u3'}}));
    expect(mgr.activeCount()).toBe(2);
    expect(created[0]!.disposed).toBe(true);
  });

  test('disposeAll disposes all sessions and clears', async () => {
    const created: ReturnType<typeof createMockSession>[] = [];
    const mgr = createGatewaySessionManager({
      createSession: async (key) => {
        const s = createMockSession(key);
        created.push(s);
        return s;
      },
      sessionConfig: {persistDir: tmpPersistDir()},
    });

    await mgr.getOrCreate(makeMsg({sender: {id: 'u1'}, peer: {kind: 'direct', id: 'u1'}}));
    await mgr.getOrCreate(makeMsg({sender: {id: 'u2'}, peer: {kind: 'direct', id: 'u2'}}));
    await mgr.disposeAll();

    expect(mgr.activeCount()).toBe(0);
    expect(created[0]!.disposed).toBe(true);
    expect(created[1]!.disposed).toBe(true);
  });

  test('uses per-channel-peer scope by default', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {persistDir: tmpPersistDir()},
    });
    const {sessionKey} = await mgr.getOrCreate(makeMsg());
    expect(sessionKey).toBe('codara:telegram:direct:user1');
  });

  test('respects custom dmScope', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
      sessionConfig: {dmScope: 'main', persistDir: tmpPersistDir()},
    });
    const {sessionKey} = await mgr.getOrCreate(makeMsg());
    expect(sessionKey).toBe('codara:main');
  });
});

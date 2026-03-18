import {describe, test, expect} from 'bun:test';
import {createGatewaySessionManager} from '@gateway/session-manager';
import type {GatewaySession} from '@gateway/session-manager';

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

describe('GatewaySessionManager', () => {
  test('getOrCreate creates a new session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
    });
    const session = await mgr.getOrCreate('key1');
    expect(session).toBeDefined();
    expect(mgr.activeCount()).toBe(1);
  });

  test('getOrCreate returns existing session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
    });
    const s1 = await mgr.getOrCreate('key1');
    const s2 = await mgr.getOrCreate('key1');
    expect(s1).toBe(s2);
    expect(mgr.activeCount()).toBe(1);
  });

  test('get returns undefined for missing key', () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
    });
    expect(mgr.get('missing')).toBeUndefined();
  });

  test('get returns existing session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
    });
    const session = await mgr.getOrCreate('key1');
    expect(mgr.get('key1')).toBe(session);
  });

  test('remove disposes and deletes session', async () => {
    const mgr = createGatewaySessionManager({
      createSession: async (key) => createMockSession(key),
    });
    const session = (await mgr.getOrCreate('key1')) as ReturnType<typeof createMockSession>;
    await mgr.remove('key1');
    expect(session.disposed).toBe(true);
    expect(mgr.get('key1')).toBeUndefined();
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
      maxSessions: 2,
    });

    await mgr.getOrCreate('key1');
    await mgr.getOrCreate('key2');
    expect(mgr.activeCount()).toBe(2);

    await mgr.getOrCreate('key3');
    expect(mgr.activeCount()).toBe(2);
    expect(created[0]!.disposed).toBe(true);
    expect(mgr.get('key1')).toBeUndefined();
    expect(mgr.get('key2')).toBeDefined();
    expect(mgr.get('key3')).toBeDefined();
  });

  test('disposeAll disposes all sessions and clears', async () => {
    const created: ReturnType<typeof createMockSession>[] = [];
    const mgr = createGatewaySessionManager({
      createSession: async (key) => {
        const s = createMockSession(key);
        created.push(s);
        return s;
      },
    });

    await mgr.getOrCreate('key1');
    await mgr.getOrCreate('key2');
    await mgr.disposeAll();

    expect(mgr.activeCount()).toBe(0);
    expect(created[0]!.disposed).toBe(true);
    expect(created[1]!.disposed).toBe(true);
  });
});

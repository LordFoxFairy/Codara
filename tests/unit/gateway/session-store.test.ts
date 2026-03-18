import {describe, test, expect} from 'bun:test';
import {createFileSessionStore, type StoredSessionEntry} from '@gateway/session-store';
import type {SessionResetPolicy} from '@gateway/types';
import {tmpdir} from 'node:os';
import path from 'node:path';

function makeEntry(overrides: Partial<StoredSessionEntry> = {}): StoredSessionEntry {
  return {
    sessionKey: 'codara:telegram:direct:user1',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    channel: 'telegram',
    peerId: 'user1',
    peerKind: 'direct',
    displayName: 'Alice',
    ...overrides,
  };
}

describe('GatewaySessionStore', () => {
  describe('shouldReset', () => {
    test('never mode — always returns false', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-never`));
      const policy: SessionResetPolicy = {mode: 'never'};
      const entry = makeEntry({lastActivityAt: 0}); // very old
      expect(store.shouldReset(entry, policy)).toBe(false);
    });

    test('idle mode — returns true when idle exceeds threshold', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-idle`));
      const policy: SessionResetPolicy = {mode: 'idle', idleMinutes: 60};
      const entry = makeEntry({lastActivityAt: Date.now() - 61 * 60 * 1000});
      expect(store.shouldReset(entry, policy)).toBe(true);
    });

    test('idle mode — returns false when recently active', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-idle2`));
      const policy: SessionResetPolicy = {mode: 'idle', idleMinutes: 60};
      const entry = makeEntry({lastActivityAt: Date.now() - 10 * 60 * 1000});
      expect(store.shouldReset(entry, policy)).toBe(false);
    });

    test('idle mode — defaults to 120 minutes', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-idle3`));
      const policy: SessionResetPolicy = {mode: 'idle'};
      const entry = makeEntry({lastActivityAt: Date.now() - 121 * 60 * 1000});
      expect(store.shouldReset(entry, policy)).toBe(true);
    });

    test('daily mode — resets when last activity before reset hour', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-daily`));
      const policy: SessionResetPolicy = {mode: 'daily', atHour: 4};
      // Last activity was yesterday
      const entry = makeEntry({lastActivityAt: Date.now() - 25 * 60 * 60 * 1000});
      expect(store.shouldReset(entry, policy)).toBe(true);
    });

    test('daily mode — does not reset when active after reset hour today', () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-daily2`));
      const policy: SessionResetPolicy = {mode: 'daily', atHour: 4};
      // Last activity was just now
      const entry = makeEntry({lastActivityAt: Date.now()});
      expect(store.shouldReset(entry, policy)).toBe(false);
    });
  });

  describe('CRUD operations', () => {
    test('save and get a session entry', async () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-crud`));
      const entry = makeEntry();
      await store.save(entry);
      const retrieved = await store.get(entry.sessionKey);
      expect(retrieved).toEqual(entry);
    });

    test('get returns undefined for missing key', async () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-miss`));
      const result = await store.get('nonexistent');
      expect(result).toBeUndefined();
    });

    test('remove deletes an entry', async () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-rm`));
      const entry = makeEntry();
      await store.save(entry);
      await store.remove(entry.sessionKey);
      const result = await store.get(entry.sessionKey);
      expect(result).toBeUndefined();
    });

    test('list returns all entries', async () => {
      const store = createFileSessionStore(path.join(tmpdir(), `codara-test-${Date.now()}-list`));
      const e1 = makeEntry({sessionKey: 'key1'});
      const e2 = makeEntry({sessionKey: 'key2'});
      await store.save(e1);
      await store.save(e2);
      const all = await store.list();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.sessionKey).sort()).toEqual(['key1', 'key2']);
    });
  });
});

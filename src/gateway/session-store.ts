import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {SessionResetPolicy} from './types';

export interface StoredSessionEntry {
  sessionKey: string;
  createdAt: number;
  lastActivityAt: number;
  channel: string;
  peerId: string;
  peerKind: 'direct' | 'group' | 'channel';
  displayName?: string;
}

export interface GatewaySessionStore {
  get(sessionKey: string): Promise<StoredSessionEntry | undefined>;
  save(entry: StoredSessionEntry): Promise<void>;
  remove(sessionKey: string): Promise<void>;
  list(): Promise<StoredSessionEntry[]>;
  /** Check if a session should be reset based on policy */
  shouldReset(entry: StoredSessionEntry, policy: SessionResetPolicy): boolean;
}

export function createFileSessionStore(persistDir?: string): GatewaySessionStore {
  const dir = persistDir ?? path.join(homedir(), '.codara', 'gateway', 'sessions');
  const indexPath = path.join(dir, 'sessions.json');

  // In-memory cache backed by file
  let cache: Map<string, StoredSessionEntry> | null = null;

  async function ensureDir(): Promise<void> {
    await mkdir(dir, {recursive: true});
  }

  async function loadIndex(): Promise<Map<string, StoredSessionEntry>> {
    if (cache) return cache;
    try {
      const raw = await readFile(indexPath, 'utf8');
      const entries = JSON.parse(raw) as Record<string, StoredSessionEntry>;
      cache = new Map(Object.entries(entries));
    } catch {
      cache = new Map();
    }
    return cache;
  }

  async function saveIndex(): Promise<void> {
    await ensureDir();
    const obj: Record<string, StoredSessionEntry> = {};
    for (const [key, entry] of cache ?? []) {
      obj[key] = entry;
    }
    // Atomic write
    const tmpPath = `${indexPath}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(obj, null, 2));
    await rename(tmpPath, indexPath);
  }

  return {
    async get(sessionKey) {
      const index = await loadIndex();
      return index.get(sessionKey);
    },

    async save(entry) {
      const index = await loadIndex();
      index.set(entry.sessionKey, entry);
      await saveIndex();
    },

    async remove(sessionKey) {
      const index = await loadIndex();
      index.delete(sessionKey);
      await saveIndex();
    },

    async list() {
      const index = await loadIndex();
      return [...index.values()];
    },

    shouldReset(entry, policy) {
      const now = Date.now();
      switch (policy.mode) {
        case 'never':
          return false;
        case 'idle': {
          const idleMs = (policy.idleMinutes ?? 120) * 60 * 1000;
          return now - entry.lastActivityAt > idleMs;
        }
        case 'daily': {
          const hour = policy.atHour ?? 4;
          const resetTime = new Date();
          resetTime.setHours(hour, 0, 0, 0);
          if (resetTime.getTime() > now) {
            resetTime.setDate(resetTime.getDate() - 1);
          }
          return entry.lastActivityAt < resetTime.getTime();
        }
      }
    },
  };
}

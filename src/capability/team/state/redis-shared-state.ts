// src/capability/team/state/redis-shared-state.ts — Redis-backed SharedState

import Redis from 'ioredis';
import type {SharedState, SharedStateEntry} from './shared-state.js';
import {MemorySharedState} from './memory-shared-state.js';

export interface RedisSharedStateConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

const STATE_PREFIX = 'codara:team:';
const DEPS_PREFIX = 'codara:deps:';

export class RedisSharedState implements SharedState {
  private readonly redis: Redis;
  private fallback: MemorySharedState | undefined;

  constructor(config: RedisSharedStateConfig) {
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      lazyConnect: true,
      retryStrategy: () => null, // don't retry, fall back
    });

    this.redis.connect().catch((err) => {
      console.warn(`[SharedState] Redis connection failed, falling back to memory: ${err}`);
      this.fallback = new MemorySharedState();
    });

    this.redis.on('error', (err) => {
      if (!this.fallback) {
        console.warn(`[SharedState] Redis error, falling back to memory: ${err}`);
        this.fallback = new MemorySharedState();
      }
    });
  }

  // ── Write ───────────────────────────────────────────────────────────

  updateTeamState(teamId: string, entry: Partial<SharedStateEntry>): void {
    if (this.fallback) {
      this.fallback.updateTeamState(teamId, entry);
      return;
    }

    const now = new Date().toISOString();
    const key = `${STATE_PREFIX}${teamId}`;

    // Fire-and-forget: read-modify-write via Lua would be ideal,
    // but for simplicity we do async get-then-set (acceptable for single-writer pattern).
    this.redis
      .get(key)
      .then((raw) => {
        const existing: SharedStateEntry | undefined = raw ? JSON.parse(raw) : undefined;
        const merged: SharedStateEntry = existing
          ? {...existing, ...entry, teamId, updatedAt: now}
          : {teamId, status: 'created', jobsSummary: {total: 0, done: 0, failed: 0}, ...entry, updatedAt: now};
        return this.redis.set(key, JSON.stringify(merged));
      })
      .catch((err) => {
        console.warn(`[SharedState] Redis write failed: ${err}`);
      });
  }

  removeTeamState(teamId: string): void {
    if (this.fallback) {
      this.fallback.removeTeamState(teamId);
      return;
    }
    this.redis.del(`${STATE_PREFIX}${teamId}`, `${DEPS_PREFIX}${teamId}`).catch(() => {});
  }

  // ── Read ────────────────────────────────────────────────────────────

  getTeamState(teamId: string): SharedStateEntry | undefined {
    if (this.fallback) return this.fallback.getTeamState(teamId);
    // Sync interface — Redis is async, so for the sync contract we return undefined.
    // Real usage should prefer the async variant or rely on memory backend.
    console.warn('[SharedState] getTeamState called synchronously on Redis backend; use memory backend for sync access');
    return undefined;
  }

  getAllTeamStates(): Map<string, SharedStateEntry> {
    if (this.fallback) return this.fallback.getAllTeamStates();
    console.warn('[SharedState] getAllTeamStates called synchronously on Redis backend; use memory backend for sync access');
    return new Map();
  }

  // ── Dependencies ────────────────────────────────────────────────────

  addDependency(dependentTeamId: string, dependsOnTeamId: string): void {
    if (this.fallback) {
      this.fallback.addDependency(dependentTeamId, dependsOnTeamId);
      return;
    }
    const key = `${DEPS_PREFIX}${dependentTeamId}`;
    this.redis
      .get(key)
      .then((raw) => {
        const deps: string[] = raw ? JSON.parse(raw) : [];
        if (!deps.includes(dependsOnTeamId)) {
          deps.push(dependsOnTeamId);
          return this.redis.set(key, JSON.stringify(deps));
        }
      })
      .catch(() => {});
  }

  getDependencies(teamId: string): string[] {
    if (this.fallback) return this.fallback.getDependencies(teamId);
    console.warn('[SharedState] getDependencies called synchronously on Redis backend');
    return [];
  }

  isDependencySatisfied(teamId: string): boolean {
    if (this.fallback) return this.fallback.isDependencySatisfied(teamId);
    console.warn('[SharedState] isDependencySatisfied called synchronously on Redis backend');
    return false;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    if (this.fallback) {
      this.fallback.clear();
      return;
    }
    // Scan and delete all codara keys — fire-and-forget
    const stream = this.redis.scanStream({match: 'codara:*', count: 100});
    stream.on('data', (keys: string[]) => {
      if (keys.length > 0) this.redis.del(...keys).catch(() => {});
    });
  }

  /** Disconnect the Redis client. */
  disconnect(): void {
    this.redis.disconnect();
  }
}

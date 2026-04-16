/**
 * Session metadata persistence.
 *
 * Stores lightweight {@link SessionState} (id, status, timestamps, metadata)
 * as JSON files alongside checkpoint data. This is the source of truth for
 * `/resume` session listing and session discovery.
 *
 * Analogous to Claude Code's session storage in `sessionStorage.ts`, but
 * using a structured directory layout (`<base>/<sessionId>/metadata.json`)
 * rather than a single JSONL file.
 *
 * @module
 */

import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';
import type {SessionState} from './types';
import {resolveDurableStoragePath, resolveDurableStoragePathCandidates} from '@durability/storage-key';

export interface SessionListOptions {
  includeArchived?: boolean;
  /** Include internal sessions (delegated subagents, background helpers). Defaults to false. */
  includeInternal?: boolean;
  sortBy?: 'createdAt' | 'updatedAt' | 'lastActivity';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  tags?: string[];
}

export interface SessionStore {
  save(sessionId: string, state: SessionState): Promise<void>;
  get(sessionId: string): Promise<SessionState | undefined>;
  list(options?: SessionListOptions): Promise<SessionState[]>;
  delete(sessionId: string): Promise<void>;
}

export class FileSessionStore implements SessionStore {
  private readonly basePath: string;

  constructor(options: {basePath?: string} = {}) {
    this.basePath = options.basePath ?? path.join(homedir(), '.codara', 'sessions');
  }

  async save(sessionId: string, state: SessionState): Promise<void> {
    const sessionDir = this.sessionDir(sessionId);
    const metadataPath = path.join(sessionDir, 'metadata.json');
    const tmpPath = `${metadataPath}.${randomUUID()}.tmp`;

    await mkdir(sessionDir, {recursive: true});
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmpPath, metadataPath);
  }

  async get(sessionId: string): Promise<SessionState | undefined> {
    for (const metadataPath of this.metadataPathCandidates(sessionId)) {
      const state = await this.readState(metadataPath);
      if (state) {
        return state;
      }
    }

    return undefined;
  }

  async list(options: SessionListOptions = {}): Promise<SessionState[]> {
    const {
      includeArchived = false,
      includeInternal = false,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      limit,
      tags,
    } = options;

    if (!existsSync(this.basePath)) {
      return [];
    }

    const entries = await readdir(this.basePath, {withFileTypes: true});
    const sessionDirs = entries.filter((entry) => entry.isDirectory());

    const sessions = new Map<string, SessionState>();
    for (const dir of sessionDirs) {
      const state = await this.readState(path.join(this.basePath, dir.name, 'metadata.json'));
      if (!state) continue;

      if (!includeArchived && state.metadata?.archived) {
        continue;
      }

      if (!includeInternal && state.metadata?.internal) {
        continue;
      }

      if (tags && tags.length > 0) {
        const sessionTags = state.metadata?.tags ?? [];
        if (!tags.some((tag) => sessionTags.includes(tag))) {
          continue;
        }
      }

      const existing = sessions.get(state.sessionId);
      if (!existing || state.updatedAt.localeCompare(existing.updatedAt) >= 0) {
        sessions.set(state.sessionId, state);
      }
    }

    const visible = [...sessions.values()];

    visible.sort((a, b) => {
      let aValue: string;
      let bValue: string;

      if (sortBy === 'lastActivity') {
        aValue = a.metadata?.lastActivity ?? a.updatedAt;
        bValue = b.metadata?.lastActivity ?? b.updatedAt;
      } else {
        aValue = a[sortBy];
        bValue = b[sortBy];
      }

      const comparison = aValue.localeCompare(bValue);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return limit ? visible.slice(0, limit) : visible;
  }

  async delete(sessionId: string): Promise<void> {
    for (const sessionDir of this.sessionDirCandidates(sessionId)) {
      if (!existsSync(sessionDir)) {
        continue;
      }

      await rm(sessionDir, {recursive: true, force: true});
    }
  }

  private sessionDir(sessionId: string): string {
    return resolveDurableStoragePath(this.basePath, sessionId);
  }

  private sessionDirCandidates(sessionId: string): string[] {
    return resolveDurableStoragePathCandidates(this.basePath, sessionId);
  }

  private metadataPathCandidates(sessionId: string): string[] {
    return this.sessionDirCandidates(sessionId).map((sessionDir) => path.join(sessionDir, 'metadata.json'));
  }

  private async readState(metadataPath: string): Promise<SessionState | undefined> {
    if (!existsSync(metadataPath)) {
      return undefined;
    }

    try {
      const content = await readFile(metadataPath, 'utf8');
      return JSON.parse(content) as SessionState;
    } catch {
      return undefined;
    }
  }
}

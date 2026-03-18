import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import type {SessionState} from './types';

export interface SessionListOptions {
  includeArchived?: boolean;
  /** Include internal sessions (delegated tasks, team workers). Defaults to false. */
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
    const sessionDir = path.join(this.basePath, sessionId);
    const metadataPath = path.join(sessionDir, 'metadata.json');

    await mkdir(sessionDir, {recursive: true});
    await writeFile(metadataPath, JSON.stringify(state, null, 2), 'utf8');
  }

  async get(sessionId: string): Promise<SessionState | undefined> {
    const metadataPath = path.join(this.basePath, sessionId, 'metadata.json');

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

  async list(options: SessionListOptions = {}): Promise<SessionState[]> {
    const {includeArchived = false, includeInternal = false, sortBy = 'updatedAt', sortOrder = 'desc', limit, tags} = options;

    if (!existsSync(this.basePath)) {
      return [];
    }

    const entries = await readdir(this.basePath, {withFileTypes: true});
    const sessionDirs = entries.filter((entry) => entry.isDirectory());

    const sessions: SessionState[] = [];
    for (const dir of sessionDirs) {
      const state = await this.get(dir.name);
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

      sessions.push(state);
    }

    sessions.sort((a, b) => {
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

    return limit ? sessions.slice(0, limit) : sessions;
  }

  async delete(sessionId: string): Promise<void> {
    const sessionDir = path.join(this.basePath, sessionId);

    if (!existsSync(sessionDir)) {
      return;
    }

    await rm(sessionDir, {recursive: true, force: true});
  }
}

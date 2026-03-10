import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import type {SessionState} from './types';

/**
 * Session 列表选项
 */
export interface SessionListOptions {
  /** 是否包含已归档的 sessions */
  includeArchived?: boolean;
  /** 按字段排序 */
  sortBy?: 'createdAt' | 'updatedAt' | 'lastActivity';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
  /** 限制返回数量 */
  limit?: number;
  /** 按标签过滤 */
  tags?: string[];
}

/**
 * Session 存储接口
 */
export interface SessionStore {
  /** 保存 session 元数据 */
  save(sessionId: string, state: SessionState): Promise<void>;

  /** 获取 session 元数据 */
  get(sessionId: string): Promise<SessionState | undefined>;

  /** 列出所有 sessions */
  list(options?: SessionListOptions): Promise<SessionState[]>;

  /** 删除 session */
  delete(sessionId: string): Promise<void>;

  /** 搜索 sessions */
  search(query: string): Promise<SessionState[]>;
}

/**
 * 基于文件系统的 Session 存储实现
 * 存储路径：~/.codara/sessions/{sessionId}/metadata.json
 */
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
    const {includeArchived = false, sortBy = 'updatedAt', sortOrder = 'desc', limit, tags} = options;

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

  async search(query: string): Promise<SessionState[]> {
    const allSessions = await this.list({includeArchived: true});
    const lowerQuery = query.toLowerCase();

    return allSessions.filter((session) => {
      if (session.metadata?.title?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      if (session.metadata?.lastMessage?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      if (session.metadata?.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
        return true;
      }

      if (session.sessionId.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      return false;
    });
  }
}

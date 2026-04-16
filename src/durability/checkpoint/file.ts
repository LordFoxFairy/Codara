/**
 * Filesystem-backed checkpoint storage.
 *
 * Each session stores a single durable checkpoint snapshot at
 * `<rootDir>/<sessionId>/checkpoints/latest.json`. Writes are atomic
 * (tmp file + rename) and protected by an advisory file lock so that
 * concurrent processes cannot corrupt the snapshot.
 *
 * Compaction strategy (compared to Claude Code):
 * - Claude Code performs conversation-level compaction by summarizing messages
 *   via a secondary LLM call, producing compact boundaries, and re-injecting
 *   recently-read files + skill content post-compact.
 * - Codara keeps it simpler: `compact()` truncates the serialized message array
 *   to `keepLast` entries and clears the parent chain. The actual conversation
 *   summarization lives in `session-compact.ts` and delegates to the middleware
 *   factory, keeping checkpoint storage concerns separate.
 *
 * @module
 */

import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointRecord,
  Checkpointer,
  CompactOptions,
  PutCheckpointInput,
} from '@durability/checkpoint/types';
import {acquireSessionLock, releaseSessionLock} from '@durability/checkpoint/lock';
import {resolveDurableStoragePath, resolveDurableStoragePathCandidates} from '@durability/storage-key';

/** Serialize/deserialize pair for JSON round-tripping checkpoint payloads. */
interface JsonCodec<T> {
  serialize(value: T): unknown;
  deserialize(raw: unknown): T;
}

export interface FileCheckpointerOptions<TState = unknown, TInfo = unknown> {
  rootDir: string;
  state: JsonCodec<TState>;
  info: JsonCodec<TInfo>;
}

interface PersistedCheckpointRecord {
  ref: {
    sessionId: string;
    checkpointId: string;
    parentCheckpointId?: string;
  };
  state: unknown;
  info: unknown;
}

/**
 * Filesystem-backed checkpointer intended for CLI / terminal persistence.
 * Each session stores a single durable checkpoint snapshot.
 */
export class FileCheckpointer<TState = unknown, TInfo = unknown>
  implements Checkpointer<TState, TInfo>
{
  private readonly rootDir: string;
  private readonly stateCodec: JsonCodec<TState>;
  private readonly infoCodec: JsonCodec<TInfo>;

  constructor(options: FileCheckpointerOptions<TState, TInfo>) {
    this.rootDir = options.rootDir;
    this.stateCodec = options.state;
    this.infoCodec = options.info;
  }

  async getLatest(sessionId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    for (const latestPath of this.latestCheckpointPathCandidates(sessionId)) {
      const record = await readJsonFile<PersistedCheckpointRecord>(latestPath);
      if (!record) {
        continue;
      }

      try {
        return this.decodeRecord(record);
      } catch {
        // Corrupted checkpoint state: treat as missing to allow session recovery.
        return undefined;
      }
    }

    return undefined;
  }

  async get(ref: {
    sessionId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const latest = await this.getLatest(ref.sessionId);
    if (!latest || latest.ref.checkpointId !== ref.checkpointId) {
      return undefined;
    }
    return latest;
  }

  async put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>> {
    const lockDir = path.join(this.rootDir, '.locks');
    await acquireSessionLock(lockDir, input.sessionId);
    try {
      const checkpointId = randomUUID();
      const record: CheckpointRecord<TState, TInfo> = {
        ref: {
          sessionId: input.sessionId,
          checkpointId,
        },
        state: input.state,
        info: input.info,
      };

      await mkdir(this.checkpointsDir(input.sessionId), {recursive: true});
      await writeJsonFile(this.latestCheckpointPath(input.sessionId), this.encodeRecord(record));

      return this.decodeRecord(this.encodeRecord(record));
    } finally {
      await releaseSessionLock(lockDir, input.sessionId);
    }
  }

  async list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const latest = await this.getLatest(sessionId);
    return latest ? [latest] : [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    for (const sessionDir of this.sessionDirCandidates(sessionId)) {
      await rm(sessionDir, {recursive: true, force: true});
    }
  }

  async compact(sessionId: string, options?: CompactOptions): Promise<void> {
    const latest = await this.getLatest(sessionId);
    if (!latest) return;

    const keepLast = options?.keepLast ?? 20;
    const threshold = Math.max(keepLast, 50);

    const state = latest.state as Record<string, unknown>;
    const hasMessages = Array.isArray(state?.messages);
    const messages = hasMessages ? (state.messages as unknown[]) : [];
    const needsMessageTruncation = hasMessages && messages.length > threshold;
    const needsParentClear = Boolean(latest.ref.parentCheckpointId);

    if (!needsMessageTruncation && !needsParentClear) return;

    const compactedState = {...state};
    if (needsMessageTruncation) {
      compactedState.messages = messages.slice(-keepLast);
    }

    const lockDir = path.join(this.rootDir, '.locks');
    await acquireSessionLock(lockDir, sessionId);
    try {
      const compactedRecord = {
        ref: {
          sessionId: latest.ref.sessionId,
          checkpointId: latest.ref.checkpointId,
        },
        state: compactedState as TState,
        info: latest.info,
      };
      await writeJsonFile(this.latestCheckpointPath(sessionId), this.encodeRecord(compactedRecord));
    } finally {
      await releaseSessionLock(lockDir, sessionId);
    }
  }

  private sessionDir(sessionId: string): string {
    return resolveDurableStoragePath(this.rootDir, sessionId);
  }

  private sessionDirCandidates(sessionId: string): string[] {
    return resolveDurableStoragePathCandidates(this.rootDir, sessionId);
  }

  private checkpointsDir(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'checkpoints');
  }

  private latestCheckpointPath(sessionId: string): string {
    return path.join(this.checkpointsDir(sessionId), 'latest.json');
  }

  private latestCheckpointPathCandidates(sessionId: string): string[] {
    return this.sessionDirCandidates(sessionId).map((sessionDir) => path.join(sessionDir, 'checkpoints', 'latest.json'));
  }

  private encodeRecord(record: CheckpointRecord<TState, TInfo>): PersistedCheckpointRecord {
    return {
      ref: {...record.ref},
      state: this.stateCodec.serialize(record.state),
      info: this.infoCodec.serialize(record.info),
    };
  }

  private decodeRecord(record: PersistedCheckpointRecord): CheckpointRecord<TState, TInfo> {
    return {
      ref: {...record.ref},
      state: this.stateCodec.deserialize(record.state),
      info: this.infoCodec.deserialize(record.info),
    };
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted JSON: treat as missing rather than crashing the session.
    return undefined;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true});
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

function isFileMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

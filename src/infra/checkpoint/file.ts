import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointRecord,
  Checkpointer,
  CompactOptions,
  PutCheckpointInput,
} from '@infra/checkpoint/types';

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
    const record = await readJsonFile<PersistedCheckpointRecord>(this.latestCheckpointPath(sessionId));
    return record ? this.decodeRecord(record) : undefined;
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
  }

  async list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const latest = await this.getLatest(sessionId);
    return latest ? [latest] : [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    await rm(this.sessionDir(sessionId), {recursive: true, force: true});
  }

  async compact(sessionId: string, options?: CompactOptions): Promise<void> {
    void sessionId;
    void options;
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, sessionId);
  }

  private checkpointsDir(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'checkpoints');
  }

  private latestCheckpointPath(sessionId: string): string {
    return path.join(this.checkpointsDir(sessionId), 'latest.json');
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
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isFileMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

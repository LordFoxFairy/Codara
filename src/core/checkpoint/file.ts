import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {CheckpointRecord, Checkpointer, PutCheckpointInput} from '@core/checkpoint/types';

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
    threadId: string;
    checkpointId: string;
    parentCheckpointId?: string;
  };
  state: unknown;
  info: unknown;
}

interface PersistedLatestPointer {
  checkpointId: string;
}

/**
 * Filesystem-backed checkpointer intended for CLI / terminal persistence.
 * Each thread stores a single head pointer plus immutable checkpoint records.
 * History order is reconstructed from `parentCheckpointId`, so there is no
 * duplicated index file to keep in sync.
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

  async getLatest(threadId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const latestPath = this.latestPointerPath(threadId);
    const latest = await readJsonFile<PersistedLatestPointer>(latestPath);
    if (!latest?.checkpointId) {
      return undefined;
    }

    return this.get({threadId, checkpointId: latest.checkpointId});
  }

  async get(ref: {
    threadId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const record = await readJsonFile<PersistedCheckpointRecord>(this.checkpointPath(ref.threadId, ref.checkpointId));
    if (!record) {
      return undefined;
    }

    return this.decodeRecord(record);
  }

  async put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>> {
    const checkpointId = randomUUID();
    const record: CheckpointRecord<TState, TInfo> = {
      ref: {
        threadId: input.threadId,
        checkpointId,
        ...(input.parentCheckpointId ? {parentCheckpointId: input.parentCheckpointId} : {}),
      },
      state: input.state,
      info: input.info,
    };

    await mkdir(this.checkpointsDir(input.threadId), {recursive: true});

    await writeJsonFile(this.checkpointPath(input.threadId, checkpointId), this.encodeRecord(record));
    await writeJsonFile(this.latestPointerPath(input.threadId), {checkpointId});

    return this.decodeRecord(this.encodeRecord(record));
  }

  async list(threadId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const records: Array<CheckpointRecord<TState, TInfo>> = [];
    const seen = new Set<string>();
    let current = await this.getLatest(threadId);

    while (current && !seen.has(current.ref.checkpointId)) {
      records.push(current);
      seen.add(current.ref.checkpointId);

      const parentCheckpointId = current.ref.parentCheckpointId;
      if (!parentCheckpointId) {
        break;
      }

      current = await this.get({threadId, checkpointId: parentCheckpointId});
    }

    return records.reverse();
  }

  async deleteThread(threadId: string): Promise<void> {
    await rm(this.threadDir(threadId), {recursive: true, force: true});
  }

  private threadDir(threadId: string): string {
    return path.join(this.rootDir, threadId);
  }

  private checkpointsDir(threadId: string): string {
    return path.join(this.threadDir(threadId), 'checkpoints');
  }

  private checkpointPath(threadId: string, checkpointId: string): string {
    return path.join(this.checkpointsDir(threadId), `${checkpointId}.json`);
  }

  private latestPointerPath(threadId: string): string {
    return path.join(this.threadDir(threadId), 'latest.json');
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

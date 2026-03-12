import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {CheckpointRecord, Checkpointer, CompactOptions, PutCheckpointInput} from '@core/checkpoint';

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

interface PersistedLatestPointer {
  checkpointId: string;
}

/**
 * Filesystem-backed checkpointer intended for CLI / terminal persistence.
 * Each session stores a single head pointer plus immutable checkpoint records.
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

  async getLatest(sessionId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const latestPath = this.latestPointerPath(sessionId);
    const latest = await readJsonFile<PersistedLatestPointer>(latestPath);
    if (!latest?.checkpointId) {
      return undefined;
    }

    return this.get({sessionId, checkpointId: latest.checkpointId});
  }

  async get(ref: {
    sessionId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const record = await readJsonFile<PersistedCheckpointRecord>(this.checkpointPath(ref.sessionId, ref.checkpointId));
    if (!record) {
      return undefined;
    }

    return this.decodeRecord(record);
  }

  async put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>> {
    const checkpointId = randomUUID();
    const record: CheckpointRecord<TState, TInfo> = {
      ref: {
        sessionId: input.sessionId,
        checkpointId,
        ...(input.parentCheckpointId ? {parentCheckpointId: input.parentCheckpointId} : {}),
      },
      state: input.state,
      info: input.info,
    };

    await mkdir(this.checkpointsDir(input.sessionId), {recursive: true});

    await writeJsonFile(this.checkpointPath(input.sessionId, checkpointId), this.encodeRecord(record));
    await writeJsonFile(this.latestPointerPath(input.sessionId), {checkpointId});

    return this.decodeRecord(this.encodeRecord(record));
  }

  async list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const records: Array<CheckpointRecord<TState, TInfo>> = [];
    const seen = new Set<string>();
    let current = await this.getLatest(sessionId);

    while (current && !seen.has(current.ref.checkpointId)) {
      records.push(current);
      seen.add(current.ref.checkpointId);

      const parentCheckpointId = current.ref.parentCheckpointId;
      if (!parentCheckpointId) {
        break;
      }

      current = await this.get({sessionId, checkpointId: parentCheckpointId});
    }

    return records.reverse();
  }

  async deleteSession(sessionId: string): Promise<void> {
    await rm(this.sessionDir(sessionId), {recursive: true, force: true});
  }

  async compact(sessionId: string, options?: CompactOptions): Promise<void> {
    const keepLast = options?.keepLast ?? 10;
    const allRecords = await this.list(sessionId);

    if (allRecords.length <= keepLast) {
      return;
    }

    const keptRecords = allRecords.slice(-keepLast);
    const toKeep = new Set(keptRecords.map((record) => record.ref.checkpointId));

    const checkpointsDir = this.checkpointsDir(sessionId);
    const files = await readdir(checkpointsDir).catch(() => []);

    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const checkpointId = file.replace('.json', '');
      if (!toKeep.has(checkpointId)) {
        await rm(path.join(checkpointsDir, file), {force: true});
      }
    }

    const oldestKept = keptRecords[0];
    if (oldestKept?.ref.parentCheckpointId) {
      const rewritten: CheckpointRecord<TState, TInfo> = {
        ...oldestKept,
        ref: {
          ...oldestKept.ref,
          parentCheckpointId: undefined,
        },
      };
      await writeJsonFile(this.checkpointPath(sessionId, oldestKept.ref.checkpointId), this.encodeRecord(rewritten));
    }
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, sessionId);
  }

  private checkpointsDir(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'checkpoints');
  }

  private checkpointPath(sessionId: string, checkpointId: string): string {
    return path.join(this.checkpointsDir(sessionId), `${checkpointId}.json`);
  }

  private latestPointerPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'latest.json');
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

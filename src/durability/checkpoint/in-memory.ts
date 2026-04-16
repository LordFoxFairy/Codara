/**
 * In-memory checkpoint storage.
 *
 * Keeps full checkpoint history per session in process memory. Suitable for
 * tests and ephemeral single-process runs; data is lost on process exit.
 *
 * When codecs are provided, records are round-tripped through serialize/deserialize
 * on every read to guarantee the same isolation semantics as the file-backed store.
 *
 * @module
 */

import {randomUUID} from 'node:crypto';
import type {
  CheckpointRecord,
  Checkpointer,
  CompactOptions,
  PutCheckpointInput,
} from '@durability/checkpoint/types';
import {deepClone} from '@shared/clone';

/** Optional serialize/deserialize pair for deep-clone isolation. */
interface MemoryCodec<T> {
  serialize(value: T): unknown;
  deserialize(raw: unknown): T;
}

/** Per-session bookkeeping: ordered list + map of checkpoint records. */
interface SessionState<TState, TInfo> {
  latestCheckpointId?: string;
  order: string[];
  records: Map<string, CheckpointRecord<TState, TInfo>>;
}

export interface InMemoryCheckpointerOptions<TState = unknown, TInfo = unknown> {
  state?: MemoryCodec<TState>;
  info?: MemoryCodec<TInfo>;
}

/**
 * In-memory checkpointer for development and testing.
 * Keeps checkpoint history in process memory and is suitable for tests and
 * local single-process runs. Data is lost when the process exits.
 */
export class InMemoryCheckpointer<TState = unknown, TInfo = unknown>
  implements Checkpointer<TState, TInfo>
{
  private readonly sessions = new Map<string, SessionState<TState, TInfo>>();
  private readonly stateCodec?: MemoryCodec<TState>;
  private readonly infoCodec?: MemoryCodec<TInfo>;

  constructor(options: InMemoryCheckpointerOptions<TState, TInfo> = {}) {
    this.stateCodec = options.state;
    this.infoCodec = options.info;
  }

  async getLatest(sessionId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session?.latestCheckpointId) {
      return undefined;
    }

    const record = session.records.get(session.latestCheckpointId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async get(ref: {
    sessionId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const record = this.sessions.get(ref.sessionId)?.records.get(ref.checkpointId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>> {
    const session = this.ensureSession(input.sessionId);
    const checkpointId = randomUUID();
    const record: CheckpointRecord<TState, TInfo> = {
      ref: {
        sessionId: input.sessionId,
        checkpointId,
        ...(input.parentCheckpointId ? {parentCheckpointId: input.parentCheckpointId} : {}),
      },
      state: this.cloneState(input.state),
      info: this.cloneInfo(input.info),
    };

    session.records.set(checkpointId, record);
    session.order.push(checkpointId);
    session.latestCheckpointId = checkpointId;
    return this.cloneRecord(record);
  }

  async list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    return session.order
      .map((checkpointId) => session.records.get(checkpointId))
      .filter((record): record is CheckpointRecord<TState, TInfo> => Boolean(record))
      .map((record) => this.cloneRecord(record));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async compact(sessionId: string, options?: CompactOptions): Promise<void> {
    const keepLast = options?.keepLast ?? 10;
    const session = this.sessions.get(sessionId);
    if (!session || session.order.length <= keepLast) {
      return;
    }

    const keptOrder = session.order.slice(-keepLast);
    const removedOrder = session.order.slice(0, -keepLast);

    for (const checkpointId of removedOrder) {
      session.records.delete(checkpointId);
    }

    session.order = keptOrder;
    const oldestKept = keptOrder[0];
    if (oldestKept) {
      const oldestRecord = session.records.get(oldestKept);
      if (oldestRecord?.ref.parentCheckpointId) {
        oldestRecord.ref.parentCheckpointId = undefined;
      }
    }
  }

  private ensureSession(sessionId: string): SessionState<TState, TInfo> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const next: SessionState<TState, TInfo> = {
      order: [],
      records: new Map<string, CheckpointRecord<TState, TInfo>>(),
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  private cloneRecord(
    record: CheckpointRecord<TState, TInfo>
  ): CheckpointRecord<TState, TInfo> {
    return {
      ref: {...record.ref},
      state: this.cloneState(record.state),
      info: this.cloneInfo(record.info),
    };
  }

  private cloneState(value: TState): TState {
    return cloneWithCodec(value, this.stateCodec);
  }

  private cloneInfo(value: TInfo): TInfo {
    return cloneWithCodec(value, this.infoCodec);
  }
}

function cloneWithCodec<T>(value: T, codec?: MemoryCodec<T>): T {
  if (!codec) {
    return deepClone(value);
  }

  return codec.deserialize(deepClone(codec.serialize(value)));
}

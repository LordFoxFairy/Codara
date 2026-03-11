import {randomUUID} from 'node:crypto';
import type {CheckpointRecord, Checkpointer, CompactOptions, PutCheckpointInput} from '@core/checkpoint/types';

interface MemoryCodec<T> {
  serialize(value: T): unknown;
  deserialize(raw: unknown): T;
}

interface ThreadState<TState, TInfo> {
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
  private readonly threads = new Map<string, ThreadState<TState, TInfo>>();
  private readonly stateCodec?: MemoryCodec<TState>;
  private readonly infoCodec?: MemoryCodec<TInfo>;

  constructor(options: InMemoryCheckpointerOptions<TState, TInfo> = {}) {
    this.stateCodec = options.state;
    this.infoCodec = options.info;
  }

  async getLatest(threadId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const thread = this.threads.get(threadId);
    if (!thread?.latestCheckpointId) {
      return undefined;
    }

    const record = thread.records.get(thread.latestCheckpointId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async get(ref: {
    threadId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const record = this.threads.get(ref.threadId)?.records.get(ref.checkpointId);
    return record ? this.cloneRecord(record) : undefined;
  }

  async put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>> {
    const thread = this.ensureThread(input.threadId);
    const checkpointId = randomUUID();
    const record: CheckpointRecord<TState, TInfo> = {
      ref: {
        threadId: input.threadId,
        checkpointId,
        ...(input.parentCheckpointId ? {parentCheckpointId: input.parentCheckpointId} : {}),
      },
      state: this.cloneState(input.state),
      info: this.cloneInfo(input.info),
    };

    thread.records.set(checkpointId, record);
    thread.order.push(checkpointId);
    thread.latestCheckpointId = checkpointId;
    return this.cloneRecord(record);
  }

  async list(threadId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return [];
    }

    return thread.order
      .map((checkpointId) => thread.records.get(checkpointId))
      .filter((record): record is CheckpointRecord<TState, TInfo> => Boolean(record))
      .map((record) => this.cloneRecord(record));
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  async compact(threadId: string, options?: CompactOptions): Promise<void> {
    const keepLast = options?.keepLast ?? 10;
    const thread = this.threads.get(threadId);
    if (!thread || thread.order.length <= keepLast) {
      return;
    }

    const keptOrder = thread.order.slice(-keepLast);
    const removedOrder = thread.order.slice(0, -keepLast);

    for (const checkpointId of removedOrder) {
      thread.records.delete(checkpointId);
    }

    thread.order = keptOrder;
    const oldestKept = keptOrder[0];
    if (oldestKept) {
      const oldestRecord = thread.records.get(oldestKept);
      if (oldestRecord?.ref.parentCheckpointId) {
        oldestRecord.ref.parentCheckpointId = undefined;
      }
    }
  }

  private ensureThread(threadId: string): ThreadState<TState, TInfo> {
    const existing = this.threads.get(threadId);
    if (existing) {
      return existing;
    }

    const next: ThreadState<TState, TInfo> = {
      order: [],
      records: new Map<string, CheckpointRecord<TState, TInfo>>(),
    };
    this.threads.set(threadId, next);
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

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }

    if (value && typeof value === 'object') {
      return {...(value as Record<string, unknown>)} as T;
    }

    return value;
  }
}

function cloneWithCodec<T>(value: T, codec?: MemoryCodec<T>): T {
  if (!codec) {
    return cloneValue(value);
  }

  return codec.deserialize(cloneValue(codec.serialize(value)));
}

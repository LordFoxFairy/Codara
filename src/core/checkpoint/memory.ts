import {randomUUID} from 'node:crypto';
import type {CheckpointRecord, Checkpointer, PutCheckpointInput} from '@core/checkpoint/types';

interface ThreadState<TState, TInfo> {
  latestCheckpointId?: string;
  order: string[];
  records: Map<string, CheckpointRecord<TState, TInfo>>;
}

/**
 * Default zero-config checkpointer.
 * It keeps checkpoint history in process memory and is suitable for tests and
 * local single-process runs.
 */
export class MemoryCheckpointer<TState = unknown, TInfo = unknown>
  implements Checkpointer<TState, TInfo>
{
  private readonly threads = new Map<string, ThreadState<TState, TInfo>>();

  async getLatest(threadId: string): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const thread = this.threads.get(threadId);
    if (!thread?.latestCheckpointId) {
      return undefined;
    }

    const record = thread.records.get(thread.latestCheckpointId);
    return record ? cloneRecord(record) : undefined;
  }

  async get(ref: {
    threadId: string;
    checkpointId: string;
  }): Promise<CheckpointRecord<TState, TInfo> | undefined> {
    const record = this.threads.get(ref.threadId)?.records.get(ref.checkpointId);
    return record ? cloneRecord(record) : undefined;
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
      state: cloneValue(input.state),
      info: cloneValue(input.info),
    };

    thread.records.set(checkpointId, record);
    thread.order.push(checkpointId);
    thread.latestCheckpointId = checkpointId;
    return cloneRecord(record);
  }

  async list(threadId: string): Promise<Array<CheckpointRecord<TState, TInfo>>> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return [];
    }

    return thread.order
      .map((checkpointId) => thread.records.get(checkpointId))
      .filter((record): record is CheckpointRecord<TState, TInfo> => Boolean(record))
      .map((record) => cloneRecord(record));
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
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
}

function cloneRecord<TState, TInfo>(
  record: CheckpointRecord<TState, TInfo>
): CheckpointRecord<TState, TInfo> {
  return {
    ref: {...record.ref},
    state: cloneValue(record.state),
    info: cloneValue(record.info),
  };
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

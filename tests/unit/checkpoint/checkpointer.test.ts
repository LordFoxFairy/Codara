import {describe, expect, it} from 'bun:test';
import {access, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileCheckpointer, MemoryCheckpointer} from '@core/checkpoint';

interface TestState {
  counter: number;
}

interface TestInfo {
  step: number;
  createdAt: string;
}

function createRecord(
  counter: number,
  step: number
): {
  state: TestState;
  info: TestInfo;
} {
  return {
    state: {counter},
    info: {
      step,
      createdAt: `2026-03-07T00:00:0${step}.000Z`,
    },
  };
}

describe('Checkpointer', () => {
  it('should store history in memory by thread', async () => {
    const checkpointer = new MemoryCheckpointer<TestState, TestInfo>();

    const first = await checkpointer.put({
      threadId: 'thread-a',
      ...createRecord(1, 1),
    });
    const second = await checkpointer.put({
      threadId: 'thread-a',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });

    expect((await checkpointer.getLatest('thread-a'))?.ref.checkpointId).toBe(second.ref.checkpointId);
    expect((await checkpointer.list('thread-a')).map((item) => item.state.counter)).toEqual([1, 2]);
  });

  it('should persist history to files with a codec', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-checkpointer-'));
    const checkpointer = new FileCheckpointer<TestState, TestInfo>({
      rootDir,
      state: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestState,
      },
      info: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestInfo,
      },
    });

    const first = await checkpointer.put({
      threadId: 'thread-b',
      ...createRecord(1, 1),
    });
    const second = await checkpointer.put({
      threadId: 'thread-b',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });

    const latest = await checkpointer.getLatest('thread-b');
    const list = await checkpointer.list('thread-b');
    const indexPath = path.join(rootDir, 'thread-b', 'index.json');

    expect(latest?.ref.checkpointId).toBe(second.ref.checkpointId);
    expect(list.map((item) => item.state.counter)).toEqual([1, 2]);
    expect(list[1]?.ref.parentCheckpointId).toBe(first.ref.checkpointId);
    await expect(access(indexPath)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('should delete a thread and clear all persisted checkpoints', async () => {
    const memory = new MemoryCheckpointer<TestState, TestInfo>();
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'codara-checkpointer-delete-'));
    const file = new FileCheckpointer<TestState, TestInfo>({
      rootDir,
      state: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestState,
      },
      info: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestInfo,
      },
    });

    for (const checkpointer of [memory, file]) {
      await checkpointer.put({
        threadId: 'thread-delete',
        ...createRecord(1, 1),
      });

      expect(await checkpointer.getLatest('thread-delete')).toBeDefined();

      await checkpointer.deleteThread('thread-delete');

      expect(await checkpointer.getLatest('thread-delete')).toBeUndefined();
      expect(await checkpointer.list('thread-delete')).toEqual([]);
    }
  });
});

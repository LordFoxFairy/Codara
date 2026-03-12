import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileCheckpointer, InMemoryCheckpointer} from '@core/checkpoint';

interface TestState {
  counter: number;
}

interface TestInfo {
  step: number;
  createdAt: string;
}

function createRecord(counter: number, step: number) {
  return {
    state: {counter},
    info: {
      step,
      createdAt: `2026-03-10T00:00:0${step}.000Z`,
    },
  };
}

describe('Checkpointer compact', () => {
  it('should keep the latest checkpoints and detach the oldest kept parent in memory', async () => {
    const checkpointer = new InMemoryCheckpointer<TestState, TestInfo>();
    const first = await checkpointer.put({sessionId: 'thread-memory', ...createRecord(1, 1)});
    const second = await checkpointer.put({
      sessionId: 'thread-memory',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });
    await checkpointer.put({
      sessionId: 'thread-memory',
      parentCheckpointId: second.ref.checkpointId,
      ...createRecord(3, 3),
    });

    await checkpointer.compact?.('thread-memory', {keepLast: 2});

    const list = await checkpointer.list('thread-memory');
    expect(list.map((item) => item.state.counter)).toEqual([2, 3]);
    expect(list[0]?.ref.parentCheckpointId).toBeUndefined();
  });

  it('should keep the latest checkpoints and detach the oldest kept parent on disk', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-checkpointer-compact-'));
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

    const first = await checkpointer.put({sessionId: 'thread-file', ...createRecord(1, 1)});
    const second = await checkpointer.put({
      sessionId: 'thread-file',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });
    await checkpointer.put({
      sessionId: 'thread-file',
      parentCheckpointId: second.ref.checkpointId,
      ...createRecord(3, 3),
    });

    await checkpointer.compact?.('thread-file', {keepLast: 2});

    const list = await checkpointer.list('thread-file');
    expect(list.map((item) => item.state.counter)).toEqual([2, 3]);
    expect(list[0]?.ref.parentCheckpointId).toBeUndefined();
  });
});

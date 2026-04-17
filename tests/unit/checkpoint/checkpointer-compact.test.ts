import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileCheckpointer, InMemoryCheckpointer} from '@state/checkpoint';

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
    const first = await checkpointer.put({sessionId: 'session-memory', ...createRecord(1, 1)});
    const second = await checkpointer.put({
      sessionId: 'session-memory',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });
    await checkpointer.put({
      sessionId: 'session-memory',
      parentCheckpointId: second.ref.checkpointId,
      ...createRecord(3, 3),
    });

    await checkpointer.compact?.('session-memory', {keepLast: 2});

    const list = await checkpointer.list('session-memory');
    expect(list.map((item) => item.state.counter)).toEqual([2, 3]);
    expect(list[0]?.ref.parentCheckpointId).toBeUndefined();
  });

  it('should truncate messages when state has a messages array exceeding threshold', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-checkpointer-compact-msg-'));

    interface MsgState {
      messages: string[];
      context: Record<string, unknown>;
    }

    const checkpointer = new FileCheckpointer<MsgState, TestInfo>({
      rootDir,
      state: {
        serialize: (value) => value,
        deserialize: (raw) => raw as MsgState,
      },
      info: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestInfo,
      },
    });

    // Create 60 messages — exceeds default threshold of 50
    const messages = Array.from({length: 60}, (_, i) => `msg-${i}`);
    await checkpointer.put({
      sessionId: 'session-msg',
      state: {messages, context: {}},
      info: {step: 1, createdAt: '2026-03-10T00:00:01.000Z'},
    });

    await checkpointer.compact?.('session-msg', {keepLast: 10});

    const latest = await checkpointer.getLatest('session-msg');
    expect(latest).toBeDefined();
    expect(latest!.state.messages).toHaveLength(10);
    expect(latest!.state.messages[0]).toBe('msg-50');
    expect(latest!.state.messages[9]).toBe('msg-59');
  });

  it('should not truncate messages when below threshold', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-checkpointer-compact-no-'));

    interface MsgState {
      messages: string[];
    }

    const checkpointer = new FileCheckpointer<MsgState, TestInfo>({
      rootDir,
      state: {
        serialize: (value) => value,
        deserialize: (raw) => raw as MsgState,
      },
      info: {
        serialize: (value) => value,
        deserialize: (raw) => raw as TestInfo,
      },
    });

    // 30 messages — below default threshold of 50
    const messages = Array.from({length: 30}, (_, i) => `msg-${i}`);
    await checkpointer.put({
      sessionId: 'session-no-trunc',
      state: {messages},
      info: {step: 1, createdAt: '2026-03-10T00:00:01.000Z'},
    });

    await checkpointer.compact?.('session-no-trunc', {keepLast: 10});

    const latest = await checkpointer.getLatest('session-no-trunc');
    expect(latest).toBeDefined();
    expect(latest!.state.messages).toHaveLength(30);
  });

  it('should return early when no checkpoint exists', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-checkpointer-compact-empty-'));
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

    // Should not throw
    await checkpointer.compact?.('nonexistent-session', {keepLast: 5});
    const latest = await checkpointer.getLatest('nonexistent-session');
    expect(latest).toBeUndefined();
  });

  it('should keep only the latest durable checkpoint on disk', async () => {
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

    const first = await checkpointer.put({sessionId: 'session-file', ...createRecord(1, 1)});
    const second = await checkpointer.put({
      sessionId: 'session-file',
      parentCheckpointId: first.ref.checkpointId,
      ...createRecord(2, 2),
    });
    await checkpointer.put({
      sessionId: 'session-file',
      parentCheckpointId: second.ref.checkpointId,
      ...createRecord(3, 3),
    });

    await checkpointer.compact?.('session-file', {keepLast: 2});

    const list = await checkpointer.list('session-file');
    expect(list.map((item) => item.state.counter)).toEqual([3]);
    expect(list[0]?.ref.parentCheckpointId).toBeUndefined();
  });
});

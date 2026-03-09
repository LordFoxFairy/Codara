import {describe, expect, it} from 'bun:test';
import {HumanMessage} from '@langchain/core/messages';
import type {AgentResult} from '@core/agents';
import {
  createInitialAgentState,
  restoreCheckpointMetadata,
  toAgentState,
  toCheckpointInfo,
  toCheckpointState,
  type MutableAgentState,
} from '@core/agents/engine/state';
import type {AgentCheckpoint} from '@core/checkpoint/state';

describe('agent checkpoint state helpers', () => {
  it('should convert runtime state into public and checkpoint snapshots without sharing mutable references', () => {
    const runtimeState = createRuntimeState();

    const publicState = toAgentState('thread-public', runtimeState);
    const checkpointState = toCheckpointState(runtimeState);

    expect(publicState.threadId).toBe('thread-public');
    expect(publicState.agentType).toBe('subagent');
    expect(checkpointState.agentType).toBe('subagent');
    expect(checkpointState.pendingPause?.id).toBe('pause-1');

    (publicState.context.nested as {flag: boolean}).flag = false;
    (checkpointState.values.todo as {done: boolean}).done = true;

    expect((runtimeState.context.nested as {flag: boolean}).flag).toBe(true);
    expect((runtimeState.values.todo as {done: boolean}).done).toBe(false);
  });

  it('should restore checkpoint metadata back into runtime state', () => {
    const runtimeState = createRuntimeState();
    const checkpointState = toCheckpointState(runtimeState);
    const publicState = toAgentState('thread-runtime', runtimeState);
    const result: AgentResult = {
      reason: 'complete',
      turns: 3,
      state: publicState,
    };

    const checkpoint: AgentCheckpoint = {
      ref: {
        threadId: 'thread-runtime',
        checkpointId: 'checkpoint-2',
      },
      state: checkpointState,
      info: toCheckpointInfo(runtimeState, 'invoke', result),
    };

    const restored = createInitialAgentState('thread-runtime', undefined);
    restoreCheckpointMetadata(restored, checkpoint);

    expect(restored.agentType).toBe('subagent');
    expect(restored.checkpointId).toBe('checkpoint-2');
    expect(restored.step).toBe(3);
    expect(restored.updatedAt).toBe(checkpoint.info.createdAt);
    expect(restored.lastResult).toEqual({
      reason: 'complete',
      turns: 3,
    });
  });
});

function createRuntimeState(): MutableAgentState {
  const state = createInitialAgentState('thread-runtime', {
    agentType: 'subagent',
    messages: [new HumanMessage('hello')],
    context: {nested: {flag: true}},
    values: {todo: {done: false}},
  });

  state.status = 'paused';
  state.pendingPause = {
    id: 'pause-1',
    description: 'Need approval',
    action: {
      toolCallId: 'tool-1',
      toolName: 'fetch',
      toolArgs: {url: 'https://example.com'},
    },
    review: {
      actionName: 'approve fetch',
      allowedDecisions: ['approve', 'edit', 'reject'],
    },
    runtime: {
      runId: 'run-1',
      turn: 1,
      requestId: 'request-1',
      toolIndex: 0,
    },
  };
  state.step = 2;

  return state;
}

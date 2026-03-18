import {describe, expect, it} from 'bun:test';
import {HumanMessage} from '@langchain/core/messages';
import type {AgentResult} from '@core/agent';
import {
  applyAgentStateSnapshot,
  cloneAgentState,
  createInitialAgentState,
  createRunContext,
  restoreCheckpointMetadata,
  toAgentState,
  toCheckpointInfo,
  toCheckpointState,
  type MutableAgentState,
} from '@core/agent';
import type {AgentCheckpoint} from '@durability/checkpoint';

describe('agent checkpoint state helpers', () => {
  it('should convert runtime state into public and checkpoint snapshots without sharing mutable references', () => {
    const runtimeState = createRuntimeState();

    const publicState = toAgentState(runtimeState);
    const checkpointState = toCheckpointState(runtimeState);

    expect(publicState.sessionId).toBe('session-runtime');
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
    const publicState = toAgentState(runtimeState);
    const result: AgentResult = {
      reason: 'complete',
      turns: 3,
      state: publicState,
    };

    const checkpoint: AgentCheckpoint = {
      ref: {
        sessionId: 'session-runtime',
        checkpointId: 'checkpoint-2',
      },
      state: checkpointState,
      info: toCheckpointInfo(runtimeState, 'invoke', result),
    };

    const restored = createInitialAgentState('session-runtime', undefined);
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

  it('should clone agent state for run usage without sharing mutable references', () => {
    const runtimeState = createRuntimeState();
    const cloned = cloneAgentState(toAgentState(runtimeState));

    cloned.messages.push(new HumanMessage('new'));
    (cloned.context.nested as {flag: boolean}).flag = false;
    (cloned.values.todo as {done: boolean}).done = true;

    expect(runtimeState.messages).toHaveLength(1);
    expect((runtimeState.context.nested as {flag: boolean}).flag).toBe(true);
    expect((runtimeState.values.todo as {done: boolean}).done).toBe(false);
  });

  it('should not rewrite the provided state when building run context', () => {
    const runtimeState = createRuntimeState();
    const state = toAgentState(runtimeState);
    const originalContext = state.context;
    const originalValues = state.values;

    const run = createRunContext(state, {
      context: {ephemeral: true},
    });

    expect(run.state).toBe(state);
    expect(state.context).toBe(originalContext);
    expect(state.values).toBe(originalValues);
    expect(run.runtimeContext).toEqual({ephemeral: true});
  });

  it('should apply a state snapshot back into runtime state with cloned data', () => {
    const runtimeState = createRuntimeState();
    const nextState = toAgentState(runtimeState);
    nextState.messages.push(new HumanMessage('next'));
    nextState.context = {nested: {flag: false}};
    nextState.values = {todo: {done: true}};
    nextState.pendingPause = undefined;

    applyAgentStateSnapshot(runtimeState, nextState);

    expect(runtimeState.messages).toHaveLength(2);
    expect((runtimeState.context.nested as {flag: boolean}).flag).toBe(false);
    expect((runtimeState.values.todo as {done: boolean}).done).toBe(true);

    nextState.messages.push(new HumanMessage('mutate-after-apply'));
    expect(runtimeState.messages).toHaveLength(2);
  });
});

function createRuntimeState(): MutableAgentState {
  const state = createInitialAgentState('session-runtime', {
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

import {describe, expect, it} from 'bun:test';
import {transition, isValidTransition} from '../../../src/cli/store/actions';
import {createInitialAppState} from '../../../src/cli/store/app-state';

describe('CLI state machine', () => {
  it('idle → running on PROMPT_SUBMITTED', () => {
    const state = createInitialAppState('test');
    const next = transition(state, {type: 'PROMPT_SUBMITTED'});
    expect(next.agentStatus).toBe('running');
    expect(next.currentTurn).toBe(1);
  });

  it('running → paused on PERMISSION_REQUESTED', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'running' as const};
    const next = transition(state, {type: 'PERMISSION_REQUESTED'});
    expect(next.agentStatus).toBe('paused');
    expect(next.permissionPending).toBe(true);
  });

  it('paused → running on PERMISSION_RESOLVED', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'paused' as const, permissionPending: true};
    const next = transition(state, {type: 'PERMISSION_RESOLVED'});
    expect(next.agentStatus).toBe('running');
    expect(next.permissionPending).toBe(false);
  });

  it('running → idle on AGENT_COMPLETED (no subagents)', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'running' as const};
    const next = transition(state, {type: 'AGENT_COMPLETED'});
    expect(next.agentStatus).toBe('idle');
  });

  it('running → subagent_wait on AGENT_COMPLETED (with subagents)', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'running' as const, runningSubagentCount: 2};
    const next = transition(state, {type: 'AGENT_COMPLETED'});
    expect(next.agentStatus).toBe('subagent_wait');
  });

  it('running → error on AGENT_ERROR', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'running' as const};
    const next = transition(state, {type: 'AGENT_ERROR', error: 'Model crash'});
    expect(next.agentStatus).toBe('error');
    expect(next.errorMessage).toBe('Model crash');
  });

  it('error → idle on ERROR_ACKNOWLEDGED', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'error' as const, errorMessage: 'crash'};
    const next = transition(state, {type: 'ERROR_ACKNOWLEDGED'});
    expect(next.agentStatus).toBe('idle');
    expect(next.errorMessage).toBeUndefined();
  });

  it('subagent_wait → running on ALL_SUBAGENTS_COMPLETED', () => {
    const state = {...createInitialAppState('test'), agentStatus: 'subagent_wait' as const, runningSubagentCount: 1};
    const next = transition(state, {type: 'ALL_SUBAGENTS_COMPLETED'});
    expect(next.agentStatus).toBe('running');
    expect(next.runningSubagentCount).toBe(0);
  });

  it('should ignore invalid transitions', () => {
    const state = createInitialAppState('test'); // idle
    const next = transition(state, {type: 'AGENT_COMPLETED'}); // can't complete from idle
    expect(next.agentStatus).toBe('idle'); // unchanged
  });

  it('isValidTransition should return correct results', () => {
    expect(isValidTransition('idle', 'PROMPT_SUBMITTED')).toBe(true);
    expect(isValidTransition('idle', 'AGENT_COMPLETED')).toBe(false);
    expect(isValidTransition('running', 'AGENT_COMPLETED')).toBe(true);
    expect(isValidTransition('error', 'RETRY')).toBe(true);
  });
});

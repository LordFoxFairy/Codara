import {describe, expect, it} from 'bun:test';
import {describeStatusIndicator} from '../../../src/cli/hooks/use-status-indicator';

describe('cli status indicator', () => {
  it('should describe the running state as thinking before text starts streaming', () => {
    expect(describeStatusIndicator({runState: {status: 'running'}}, 0).banner).toBe('⠋ Thinking...');
    expect(describeStatusIndicator({runState: {status: 'running'}}, 1).banner).toBe('⠙ Thinking...');
    expect(describeStatusIndicator({runState: {status: 'running'}}, 2).banner).toBe('⠹ Thinking...');
    expect(describeStatusIndicator({runState: {status: 'running'}}, 3).banner).toBe('⠸ Thinking...');
  });

  it('should switch to responding once reply text is streaming', () => {
    expect(describeStatusIndicator({
      runState: {status: 'running'},
      activeTurn: {
        id: 'turn-1',
        prompt: 'hello',
        response: 'partial',
        responseRole: 'assistant',
      },
    }, 0).banner).toBe('⠋ Responding...');
  });

  it('should not fall back to thinking once a visible assistant reply already exists outside the active turn', () => {
    expect(describeStatusIndicator({
      runState: {status: 'running', phase: 'subagent_completion'},
      hasVisibleAssistantReply: true,
    }, 0).banner).toBe('⠋ Responding...');
  });

  it('should show a thinking bridge while the main agent is resuming after subagents finish', () => {
    expect(describeStatusIndicator({
      runState: {status: 'running', phase: 'subagent_completion'},
      runningSubagentRunCount: 0,
      pausedSubagentRunCount: 0,
    }, 0).banner).toBe('⠋ Thinking...');

    expect(describeStatusIndicator({
      runState: {status: 'running', phase: 'subagent_completion'},
      activeTurn: {
        id: 'turn-2',
        prompt: 'hello',
        response: 'partial',
        responseRole: 'assistant',
      },
      runningSubagentRunCount: 0,
      pausedSubagentRunCount: 0,
    }, 0).banner).toBe('⠋ Responding...');
  });

  it('should describe paused, done, idle, and error states with product-facing text', () => {
    expect(describeStatusIndicator({runState: {status: 'paused'}}).banner).toBe('⏺ Waiting for input');
    expect(describeStatusIndicator({runState: {status: 'done'}}).banner).toBeUndefined();
    expect(describeStatusIndicator({runState: {status: 'done'}}).status).toBe('Ready');
    expect(describeStatusIndicator({runState: {status: 'idle'}}).banner).toBeUndefined();
    expect(describeStatusIndicator({runState: {status: 'idle'}}).status).toBe('Ready');
    expect(describeStatusIndicator({runState: {status: 'error', error: 'boom'}}).banner).toBe('✕ Review the latest error');
  });

  it('should surface runtime event labels for active review and command work', () => {
    expect(describeStatusIndicator({
      runState: {status: 'paused'},
      latestRuntimeEvent: {
        id: 'evt-1',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'review',
        phase: 'start',
        status: 'paused',
        label: 'Permission review required',
      },
    }).banner).toBe('⏺ Permission review required');
    expect(describeStatusIndicator({
      runState: {status: 'running'},
      latestRuntimeEvent: {
        id: 'evt-2',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        kind: 'command',
        phase: 'start',
        status: 'running',
        label: 'Running /reload',
      },
    }).banner).toBe('⠋ Running /reload');
  });
});

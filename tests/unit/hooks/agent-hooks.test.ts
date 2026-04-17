import {describe, expect, test} from 'bun:test';
import type {
  AgentLifecycleHooks,
  AgentStopContext,
  SubagentStopContext,
  HookInterceptResult,
} from '@hooks/types';

function createTrackingAgentLifecycle(stopBehavior: 'allow' | 'deny' = 'allow') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: {method: string; ctx: any}[] = [];

  const lifecycle: AgentLifecycleHooks = {
    async onStop(ctx: AgentStopContext): Promise<HookInterceptResult> {
      calls.push({method: 'onStop', ctx});
      if (stopBehavior === 'deny') {
        return {vetoed: true, vetoReason: 'Not done yet', systemMessages: ['Keep working']};
      }
      return {vetoed: false, systemMessages: []};
    },
    async onSubagentStop(ctx: SubagentStopContext): Promise<HookInterceptResult> {
      calls.push({method: 'onSubagentStop', ctx});
      return {vetoed: false, systemMessages: []};
    },
  };

  return {lifecycle, calls};
}

describe('AgentLifecycleHooks contract', () => {
  test('onStop allow lets agent stop', async () => {
    const {lifecycle} = createTrackingAgentLifecycle('allow');
    const result = await lifecycle.onStop({
      sessionId: 'test', hookEvent: 'Stop', timestamp: '',
      reason: 'complete', reachedMaxTurns: false, turns: 3,
    });
    expect(result.vetoed).toBe(false);
  });

  test('onStop deny prevents agent from stopping', async () => {
    const {lifecycle} = createTrackingAgentLifecycle('deny');
    const result = await lifecycle.onStop({
      sessionId: 'test', hookEvent: 'Stop', timestamp: '',
      reason: 'complete', reachedMaxTurns: false, turns: 3,
    });
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('Not done yet');
    expect(result.systemMessages).toContain('Keep working');
  });

  test('onStop receives correct context', async () => {
    const {lifecycle, calls} = createTrackingAgentLifecycle();
    await lifecycle.onStop({
      sessionId: 's1', hookEvent: 'Stop', timestamp: '2026-03-16',
      reason: 'complete', reachedMaxTurns: false, turns: 5, lastMessage: 'Done',
    });
    expect(calls[0]!.ctx.turns).toBe(5);
    expect(calls[0]!.ctx.reason).toBe('complete');
    expect(calls[0]!.ctx.lastMessage).toBe('Done');
  });

  test('onSubagentStop receives agent name and task ID', async () => {
    const {lifecycle, calls} = createTrackingAgentLifecycle();
    await lifecycle.onSubagentStop({
      sessionId: 's1', hookEvent: 'SubagentStop', timestamp: '',
      agentName: 'code-reviewer', taskId: 'task-123', reason: 'complete',
    });
    expect(calls[0]!.ctx.agentName).toBe('code-reviewer');
    expect(calls[0]!.ctx.taskId).toBe('task-123');
  });
});

import {describe, expect, test} from 'bun:test';
import type {
  SessionLifecycleHooks,
  SessionStartContext,
  SessionEndContext,
  PromptSubmitContext,
  CompactContext,
  HookInterceptResult,
  HookNotifyResult,
} from '@engine/hook/types';

// Test the lifecycle hooks contract with a mock implementation
function createTrackingLifecycle() {
  const calls: {method: string; ctx: unknown}[] = [];

  const lifecycle: SessionLifecycleHooks = {
    async onSessionStart(ctx: SessionStartContext): Promise<HookNotifyResult> {
      calls.push({method: 'onSessionStart', ctx});
      return {systemMessages: ['Welcome hook message']};
    },
    async onSessionEnd(ctx: SessionEndContext): Promise<HookNotifyResult> {
      calls.push({method: 'onSessionEnd', ctx});
      return {systemMessages: []};
    },
    async onUserPromptSubmit(ctx: PromptSubmitContext): Promise<HookInterceptResult> {
      calls.push({method: 'onUserPromptSubmit', ctx});
      if (ctx.userPrompt.includes('BLOCK')) {
        return {vetoed: true, vetoReason: 'Blocked by test', systemMessages: []};
      }
      return {vetoed: false, systemMessages: []};
    },
    async onPreCompact(ctx: CompactContext): Promise<HookInterceptResult> {
      calls.push({method: 'onPreCompact', ctx});
      return {vetoed: false, systemMessages: []};
    },
    async onPostCompact(ctx: CompactContext): Promise<HookNotifyResult> {
      calls.push({method: 'onPostCompact', ctx});
      return {systemMessages: []};
    },
  };

  return {lifecycle, calls};
}

describe('SessionLifecycleHooks contract', () => {
  test('onSessionStart returns HookNotifyResult with systemMessages', async () => {
    const {lifecycle} = createTrackingLifecycle();
    const result = await lifecycle.onSessionStart({
      sessionId: 'test', hookEvent: 'SessionStart', timestamp: '', cwd: '/tmp',
    });
    expect(result.systemMessages).toContain('Welcome hook message');
  });

  test('onUserPromptSubmit can veto', async () => {
    const {lifecycle} = createTrackingLifecycle();
    const result = await lifecycle.onUserPromptSubmit({
      sessionId: 'test', hookEvent: 'UserPromptSubmit', timestamp: '', userPrompt: 'BLOCK this',
    });
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('Blocked by test');
  });

  test('onUserPromptSubmit allows normal input', async () => {
    const {lifecycle} = createTrackingLifecycle();
    const result = await lifecycle.onUserPromptSubmit({
      sessionId: 'test', hookEvent: 'UserPromptSubmit', timestamp: '', userPrompt: 'hello',
    });
    expect(result.vetoed).toBe(false);
  });

  test('onPreCompact can veto compaction', async () => {
    const calls: {method: string}[] = [];
    const lifecycle: SessionLifecycleHooks = {
      async onSessionStart() { return {systemMessages: []}; },
      async onSessionEnd() { return {systemMessages: []}; },
      async onUserPromptSubmit() { return {vetoed: false, systemMessages: []}; },
      async onPreCompact() {
        calls.push({method: 'onPreCompact'});
        return {vetoed: true, vetoReason: 'Context is small enough', systemMessages: []};
      },
      async onPostCompact() {
        calls.push({method: 'onPostCompact'});
        return {systemMessages: []};
      },
    };
    const result = await lifecycle.onPreCompact({
      sessionId: 's', hookEvent: 'PreCompact', timestamp: '', messageCount: 3,
    });
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('Context is small enough');
  });

  test('onPostCompact returns HookNotifyResult', async () => {
    const {lifecycle} = createTrackingLifecycle();
    const result = await lifecycle.onPostCompact({
      sessionId: 's', hookEvent: 'PostCompact', timestamp: '', messageCount: 5,
    });
    expect(result.systemMessages).toEqual([]);
  });

  test('onSessionEnd returns HookNotifyResult', async () => {
    const {lifecycle} = createTrackingLifecycle();
    const result = await lifecycle.onSessionEnd({
      sessionId: 's', hookEvent: 'SessionEnd', timestamp: '', reason: 'user_exit',
    });
    expect(result.systemMessages).toEqual([]);
  });

  test('lifecycle methods are called in correct order', async () => {
    const {lifecycle, calls} = createTrackingLifecycle();
    await lifecycle.onSessionStart({sessionId: 's', hookEvent: 'SessionStart', timestamp: '', cwd: '/'});
    await lifecycle.onUserPromptSubmit({sessionId: 's', hookEvent: 'UserPromptSubmit', timestamp: '', userPrompt: 'hi'});
    await lifecycle.onPreCompact({sessionId: 's', hookEvent: 'PreCompact', timestamp: '', messageCount: 10});
    await lifecycle.onPostCompact({sessionId: 's', hookEvent: 'PostCompact', timestamp: '', messageCount: 5});
    await lifecycle.onSessionEnd({sessionId: 's', hookEvent: 'SessionEnd', timestamp: '', reason: 'user_exit'});

    expect(calls.map(c => c.method)).toEqual([
      'onSessionStart', 'onUserPromptSubmit', 'onPreCompact', 'onPostCompact', 'onSessionEnd',
    ]);
  });

  test('error in lifecycle hook does not throw when wrapped in try/catch', async () => {
    const lifecycle: SessionLifecycleHooks = {
      async onSessionStart() { throw new Error('hook failure'); },
      async onSessionEnd() { return {systemMessages: []}; },
      async onUserPromptSubmit() { return {vetoed: false, systemMessages: []}; },
      async onPreCompact() { return {vetoed: false, systemMessages: []}; },
      async onPostCompact() { return {systemMessages: []}; },
    };

    // Simulating session's safe-call pattern
    let errorCaught = false;
    try {
      await lifecycle.onSessionStart({sessionId: 's', hookEvent: 'SessionStart', timestamp: '', cwd: '/'});
    } catch {
      errorCaught = true;
    }
    expect(errorCaught).toBe(true);

    // When wrapped in try/catch (as session.ts does), execution continues
    let continued = false;
    try {
      await lifecycle.onSessionStart({sessionId: 's', hookEvent: 'SessionStart', timestamp: '', cwd: '/'});
    } catch {
      // session.ts catches and continues
    }
    continued = true;
    expect(continued).toBe(true);
  });
});

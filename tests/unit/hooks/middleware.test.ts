import {describe, expect, test} from 'bun:test';
import {createToolHooksBridge} from '@observability/hook/bridge';
import type {ToolLifecycleHooks, ToolResultContext} from '@observability/hook/types';
import {ToolMessage} from '@langchain/core/messages';

function createMockLifecycle(overrides: Partial<ToolLifecycleHooks> = {}): ToolLifecycleHooks {
  return {
    onPreToolUse: async () => ({vetoed: false, systemMessages: []}),
    onPostToolUse: async () => ({systemMessages: []}),
    ...overrides,
  };
}

function createMockToolCallContext(toolName = 'Bash', args: Record<string, unknown> = {command: 'ls'}) {
  return {
    state: {messages: []},
    messages: [],
    runtime: {context: {}, shared: {}},
    systemMessage: [] as string[],
    execution: {sessionId: 'test', runId: 'r1', turn: 1, maxTurns: 10, requestId: 'req1', toolCallId: 'tc1'},
    toolCall: {name: toolName, args, id: 'tc1'},
    toolIndex: 0,
  } as any;
}

describe('ToolHooksMiddleware', () => {
  test('passes through when PreToolUse allows', async () => {
    const lifecycle = createMockLifecycle();
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext();
    const handler = async () => new ToolMessage({content: 'result', tool_call_id: 'tc1'});

    const result = await mw.wrapToolCall!(ctx, handler);
    expect(result.content).toBe('result');
  });

  test('returns deny message when PreToolUse vetoes', async () => {
    const lifecycle = createMockLifecycle({
      onPreToolUse: async () => ({vetoed: true, vetoReason: 'Blocked by hook', systemMessages: []}),
    });
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext();
    const handler = async () => new ToolMessage({content: 'should not reach', tool_call_id: 'tc1'});

    const result = await mw.wrapToolCall!(ctx, handler);
    expect(String(result.content)).toContain('Blocked by hook');
  });

  test('applies modifiedInput from PreToolUse', async () => {
    let capturedArgs: any;
    const lifecycle = createMockLifecycle({
      onPreToolUse: async () => ({
        vetoed: false,
        modifiedInput: {command: 'ls -la'},
        systemMessages: [],
      }),
    });
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext('Bash', {command: 'ls'});
    const handler = async (c: any) => {
      capturedArgs = c.toolCall.args;
      return new ToolMessage({content: 'ok', tool_call_id: 'tc1'});
    };

    await mw.wrapToolCall!(ctx, handler);
    expect(capturedArgs.command).toBe('ls -la');
  });

  test('stores systemMessages in runtime.shared.pendingHookMessages', async () => {
    const lifecycle = createMockLifecycle({
      onPreToolUse: async () => ({
        vetoed: false,
        systemMessages: ['Remember to check tests'],
      }),
    });
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext();
    const handler = async () => new ToolMessage({content: 'ok', tool_call_id: 'tc1'});

    await mw.wrapToolCall!(ctx, handler);
    expect((ctx.runtime.shared as any).pendingHookMessages).toContain('Remember to check tests');
  });

  test('calls PostToolUse after execution (non-blocking)', async () => {
    let postCalled = false;
    const lifecycle = createMockLifecycle({
      onPostToolUse: async (ctx: ToolResultContext) => {
        postCalled = true;
        expect(ctx.toolName).toBe('Bash');
        expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
        return {systemMessages: []};
      },
    });
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext();
    const handler = async () => new ToolMessage({content: 'done', tool_call_id: 'tc1'});

    await mw.wrapToolCall!(ctx, handler);
    // Give void promise a tick to resolve
    await new Promise(r => setTimeout(r, 10));
    expect(postCalled).toBe(true);
  });
});

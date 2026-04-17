import {describe, expect, test} from 'bun:test';
import {createToolHooksBridge} from '@hooks/bridge';
import type {TaskCreatedContext, TaskCompletedContext, TaskLifecycleHooks, ToolLifecycleHooks, ToolResultContext} from '@hooks/types';
import {ToolMessage} from '@langchain/core/messages';
import {TASK_CREATE_TOOL_NAME, TASK_UPDATE_TOOL_NAME} from '@tasks/tools';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  test('fires onTaskCreated after TaskCreate tool call', async () => {
    let capturedCtx: TaskCreatedContext | undefined;
    const lifecycle: ToolLifecycleHooks & Partial<TaskLifecycleHooks> = {
      ...createMockLifecycle(),
      onTaskCreated: async (ctx: TaskCreatedContext) => {
        capturedCtx = ctx;
        return {systemMessages: []};
      },
    };
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext(TASK_CREATE_TOOL_NAME, {
      subject: 'Fix the bug',
      description: 'There is a bug in login',
    });
    const taskResult = 'Task created.\n- id: abc-123 | subject: Fix the bug | status: pending | description: There is a bug in login';
    const handler = async () => new ToolMessage({content: taskResult, tool_call_id: 'tc1'});

    await mw.wrapToolCall!(ctx, handler);
    await new Promise(r => setTimeout(r, 10));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.hookEvent).toBe('TaskCreated');
    expect(capturedCtx!.taskId).toBe('abc-123');
    expect(capturedCtx!.subject).toBe('Fix the bug');
    expect(capturedCtx!.description).toBe('There is a bug in login');
    expect(capturedCtx!.sessionId).toBe('test');
  });

  test('fires onTaskCompleted when TaskUpdate sets status to completed', async () => {
    let capturedCtx: TaskCompletedContext | undefined;
    const lifecycle: ToolLifecycleHooks & Partial<TaskLifecycleHooks> = {
      ...createMockLifecycle(),
      onTaskCompleted: async (ctx: TaskCompletedContext) => {
        capturedCtx = ctx;
        return {systemMessages: []};
      },
    };
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext(TASK_UPDATE_TOOL_NAME, {
      taskId: 'task-456',
      status: 'completed',
    });
    const taskResult = 'Task updated.\n- id: task-456 | subject: Deploy feature | status: completed | description: Deploy to prod';
    const handler = async () => new ToolMessage({content: taskResult, tool_call_id: 'tc1'});

    await mw.wrapToolCall!(ctx, handler);
    await new Promise(r => setTimeout(r, 10));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.hookEvent).toBe('TaskCompleted');
    expect(capturedCtx!.taskId).toBe('task-456');
    expect(capturedCtx!.subject).toBe('Deploy feature');
    expect(capturedCtx!.status).toBe('completed');
    expect(capturedCtx!.sessionId).toBe('test');
  });

  test('does not fire onTaskCompleted when status is not completed', async () => {
    let completedCalled = false;
    const lifecycle: ToolLifecycleHooks & Partial<TaskLifecycleHooks> = {
      ...createMockLifecycle(),
      onTaskCompleted: async () => {
        completedCalled = true;
        return {systemMessages: []};
      },
    };
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext(TASK_UPDATE_TOOL_NAME, {
      taskId: 'task-789',
      status: 'in_progress',
    });
    const taskResult = 'Task updated.\n- id: task-789 | subject: Some task | status: in_progress';
    const handler = async () => new ToolMessage({content: taskResult, tool_call_id: 'tc1'});

    await mw.wrapToolCall!(ctx, handler);
    await new Promise(r => setTimeout(r, 10));

    expect(completedCalled).toBe(false);
  });

  test('does not fire task hooks when lifecycle lacks task methods', async () => {
    const lifecycle = createMockLifecycle();
    const mw = createToolHooksBridge(lifecycle);

    const ctx = createMockToolCallContext(TASK_CREATE_TOOL_NAME, {
      subject: 'Test',
      description: 'Test desc',
    });
    const taskResult = 'Task created.\n- id: abc-123 | subject: Test | status: pending | description: Test desc';
    const handler = async () => new ToolMessage({content: taskResult, tool_call_id: 'tc1'});

    // Should not throw
    await mw.wrapToolCall!(ctx, handler);
    await new Promise(r => setTimeout(r, 10));
  });
});

import {describe, expect, it} from 'bun:test';
import {ToolMessage} from '@langchain/core/messages';
import {
  type CodaraMode,
  createPlanModeMiddleware,
  isModeWriteAllowed,
} from '@engine/pipeline/plan-mode';
import type {BeforeModelContext, ToolCallContext, ToolCallHandler} from '@engine/pipeline/types';

function makeBeforeModelContext(): BeforeModelContext {
  return {
    state: {messages: []},
    messages: [],
    runtime: {context: {}},
    systemMessage: [],
    execution: {} as BeforeModelContext['execution'],
  } as BeforeModelContext;
}

function makeToolCallContext(name: string, id: string): ToolCallContext {
  return {
    state: {messages: []},
    messages: [],
    runtime: {context: {}},
    systemMessage: [],
    execution: {} as ToolCallContext['execution'],
    toolCall: {name, id, args: {}, type: 'tool_call'},
    toolIndex: 0,
  } as ToolCallContext;
}

const passthroughHandler: ToolCallHandler = async (ctx) =>
  new ToolMessage({content: 'ok', tool_call_id: ctx!.toolCall.id});

describe('PlanModeMiddleware', () => {
  const middleware = createPlanModeMiddleware();

  it('has correct name', () => {
    expect(middleware.name).toBe('PlanModeMiddleware');
  });

  describe('beforeModel', () => {
    it('注入 plan 模式系统提示', async () => {
      const context = makeBeforeModelContext();
      await middleware.beforeModel!(context);
      expect(context.systemMessage).toHaveLength(1);
      expect(context.systemMessage[0]).toContain('PLAN mode');
    });
  });

  describe('wrapToolCall', () => {
    it('阻止 write_file', async () => {
      const ctx = makeToolCallContext('write_file', 'call-1');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toContain('Blocked');
      expect(result.content).toContain('write_file');
      expect(result.tool_call_id).toBe('call-1');
    });

    it('阻止 edit_file', async () => {
      const ctx = makeToolCallContext('edit_file', 'call-2');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toContain('Blocked');
      expect(result.content).toContain('edit_file');
    });

    it('允许 read_file 通过', async () => {
      const ctx = makeToolCallContext('read_file', 'call-3');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toBe('ok');
    });

    it('允许 glob 通过', async () => {
      const ctx = makeToolCallContext('glob', 'call-4');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toBe('ok');
    });

    it('允许 grep 通过', async () => {
      const ctx = makeToolCallContext('grep', 'call-5');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toBe('ok');
    });

    it('允许 bash 通过', async () => {
      const ctx = makeToolCallContext('bash', 'call-6');
      const result = await middleware.wrapToolCall!(ctx, passthroughHandler);
      expect(result.content).toBe('ok');
    });
  });

  describe('isModeWriteAllowed', () => {
    it('normal 模式允许写操作', () => {
      expect(isModeWriteAllowed('normal')).toBe(true);
    });

    it('auto 模式允许写操作', () => {
      expect(isModeWriteAllowed('auto')).toBe(true);
    });

    it('plan 模式禁止写操作', () => {
      expect(isModeWriteAllowed('plan')).toBe(false);
    });
  });

  describe('CodaraMode type', () => {
    it('接受 normal / plan / auto 三个值', () => {
      const modes: CodaraMode[] = ['normal', 'plan', 'auto'];
      expect(modes).toHaveLength(3);
    });
  });
});

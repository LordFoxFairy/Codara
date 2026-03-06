import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentRunner} from '@core/agents';
import {createLoggingMiddleware, type MiddlewareLogRecord} from '@core/middleware';

class FakeModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[], private readonly throwAtIndex = -1) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;

    if (this.throwAtIndex === this.index) {
      this.index += 1;
      throw new Error('model boom');
    }

    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No fake response at index ${this.index}`);
    }

    this.index += 1;
    return current;
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

describe('createLoggingMiddleware', () => {
  it('should emit structured stage logs in agent runtime', async () => {
    const toolCall: ToolCall = {id: 'call_log_1', name: 'echo', args: {text: 'ping'}};
    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done')
    ]) as unknown as BaseChatModel;

    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const logs: MiddlewareLogRecord[] = [];
    const loggingMiddleware = createLoggingMiddleware({
      level: 'debug',
      logger: (record) => logs.push(record),
    });

    const runner = createAgentRunner({
      model,
      tools: [tool],
      middlewares: [loggingMiddleware],
    });

    const result = await runner.invoke(
      {messages: [new HumanMessage('start')]},
      {recursionLimit: 4}
    );

    expect(result.reason).toBe('complete');
    expect(logs.length).toBeGreaterThan(0);

    const wrapModelStart = logs.find((record) => record.stage === 'wrapModelCall' && record.event === 'stage_start');
    const wrapModelEnd = logs.find((record) => record.stage === 'wrapModelCall' && record.event === 'stage_end');
    const wrapToolEnd = logs.find((record) => record.stage === 'wrapToolCall' && record.event === 'stage_end');

    expect(wrapModelStart).toBeDefined();
    expect(wrapModelEnd).toBeDefined();
    expect(wrapModelEnd?.durationMs).toBeGreaterThanOrEqual(0);

    expect(wrapToolEnd?.toolName).toBe('echo');
    expect(wrapToolEnd?.toolCallId).toBe('call_log_1');
    expect(wrapToolEnd?.toolIndex).toBe(0);

    const afterAgentEndLogs = logs.filter((record) => record.stage === 'afterAgent' && record.event === 'stage_end');
    expect(afterAgentEndLogs.some((record) => record.resultReason === 'complete')).toBe(true);
  });

  it('should filter debug logs when level is info', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;

    const logs: MiddlewareLogRecord[] = [];
    const loggingMiddleware = createLoggingMiddleware({
      level: 'info',
      logger: (record) => logs.push(record),
    });

    const runner = createAgentRunner({
      model,
      tools: [],
      middlewares: [loggingMiddleware],
    });

    const result = await runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 2});
    expect(result.reason).toBe('complete');

    expect(logs.some((record) => record.event === 'stage_start')).toBe(false);
    expect(logs.some((record) => record.event === 'stage_end')).toBe(true);
  });

  it('should emit stage_error on model failure', async () => {
    const model = new FakeModel([], 0) as unknown as BaseChatModel;

    const logs: MiddlewareLogRecord[] = [];
    const loggingMiddleware = createLoggingMiddleware({
      level: 'debug',
      logger: (record) => logs.push(record),
    });

    const runner = createAgentRunner({
      model,
      tools: [],
      middlewares: [loggingMiddleware],
    });

    const result = await runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 1});
    expect(result.reason).toBe('error');

    const errorLog = logs.find((record) => record.stage === 'wrapModelCall' && record.event === 'stage_error');
    expect(errorLog).toBeDefined();
    expect(errorLog?.level).toBe('error');
    expect(errorLog?.errorMessage).toContain('model boom');
  });
});

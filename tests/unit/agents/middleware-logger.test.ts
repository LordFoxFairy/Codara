import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentRunner} from '@core/agents';
import {createMiddleware} from '@core/middleware';

class FakeModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
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

describe('Agent Middleware Logger', () => {
  it('应打印每个阶段日志并保持顺序稳定', async () => {
    const toolCall: ToolCall = {id: 'call_log_1', name: 'echo', args: {text: 'ping'}};
    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done')
    ];

    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const logs: string[] = [];
    const loggingMiddleware = createMiddleware({
      name: 'stage-logger',
      beforeAgent: (context) => {
        logs.push(`beforeAgent:${context.turn}`);
      },
      beforeModel: (context) => {
        logs.push(`beforeModel:${context.turn}`);
      },
      wrapModelCall: async (request, handler) => {
        logs.push(`wrapModelCall:start:${request.turn}`);
        const response = await handler(request);
        logs.push(`wrapModelCall:end:${request.turn}`);
        return response;
      },
      afterModel: (context) => {
        logs.push(`afterModel:${context.turn}`);
      },
      wrapToolCall: async (request, handler) => {
        logs.push(`wrapToolCall:start:${request.turn}:${request.toolCall.name}`);
        const message = await handler(request);
        logs.push(`wrapToolCall:end:${request.turn}:${request.toolCall.name}`);
        return message;
      },
      afterAgent: (context) => {
        logs.push(`afterAgent:${context.turn}:${context.result.reason}`);
      }
    });
    const runner = createAgentRunner({
      model,
      tools: [tool],
      middlewares: [loggingMiddleware]
    });

    const result = await runner.invoke(
      {
        messages: [new HumanMessage('start')]
      },
      {recursionLimit: 4}
    );

    expect(result.reason).toBe('complete');
    expect(logs).toEqual([
      'beforeAgent:1',
      'beforeModel:1',
      'wrapModelCall:start:1',
      'wrapModelCall:end:1',
      'afterModel:1',
      'wrapToolCall:start:1:echo',
      'wrapToolCall:end:1:echo',
      'afterAgent:1:continue',
      'beforeAgent:2',
      'beforeModel:2',
      'wrapModelCall:start:2',
      'wrapModelCall:end:2',
      'afterModel:2',
      'afterAgent:2:complete'
    ]);
  });
});

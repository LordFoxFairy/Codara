import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgentRunner} from '@core/agents';
import type {BaseMiddleware} from '@core/middleware';

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

describe('AgentRunner', () => {
  it('无 tool_calls 时应直接 complete', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgentRunner({model});

    const result = await runner.invoke({messages: [new HumanMessage('hello')]});

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(1);
    expect(result.state.messages.length).toBe(2);
    expect(result.state.messages[0]).toBeInstanceOf(HumanMessage);
    expect(result.state.messages[1]).toBeInstanceOf(AIMessage);
  });

  it('有 tool_calls 时应执行工具并回写 ToolMessage', async () => {
    const toolCall: ToolCall = {id: 'call_1', name: 'echo', args: {text: 'ping'}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('final')
    ];

    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const runner = createAgentRunner({model, tools: [tool]});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(2);

    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage.tool_call_id).toBe('call_1');
    expect(toolMessage.content).toBe('pong');
  });

  it('工具不存在时应返回错误 ToolMessage 而不是崩溃', async () => {
    const toolCall: ToolCall = {id: 'call_404', name: 'missing_tool', args: {}};
    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done')
    ];

    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const runner = createAgentRunner({model});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage.content).toContain('Tool "missing_tool" not found');
    expect(toolMessage.status).toBe('error');
  });

  it('工具执行失败时应返回错误 ToolMessage 让模型可继续', async () => {
    const toolCall: ToolCall = {id: 'call_err', name: 'echo', args: {text: 'ping'}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => {
        throw new Error('tool boom');
      }
    } as unknown as StructuredToolInterface;

    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done')
    ];

    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const runner = createAgentRunner({model, tools: [tool]});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage.content).toContain('Tool execution failed: tool boom');
    expect(toolMessage.status).toBe('error');
  });

  it('tool_call 缺少 id 时应使用稳定 fallback id', async () => {
    const toolCall = {name: 'echo', args: {text: 'ping'}} as ToolCall;
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done')
    ];

    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const runner = createAgentRunner({model, tools: [tool]});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage.tool_call_id).toBe('echo_0');
    expect(toolMessage.content).toBe('pong');
  });

  it('模型调用失败时应返回 error', async () => {
    const model = {
      invoke: async () => {
        throw new Error('model boom');
      },
      bindTools: () => ({
        invoke: async () => {
          throw new Error('model boom');
        }
      })
    } as unknown as BaseChatModel;

    const runner = createAgentRunner({model});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('error');
    expect(result.error?.message).toBe('model boom');
  });

  it('达到 recursionLimit 时应返回 max_turns', async () => {
    const toolCall: ToolCall = {id: 'call_loop', name: 'echo', args: {}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const model = new FakeModel(
      Array.from({length: 20}, () => new AIMessage({content: '', tool_calls: [toolCall]}))
    ) as unknown as BaseChatModel;

    const runner = createAgentRunner({model, tools: [tool]});
    const result = await runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 3});

    expect(result.reason).toBe('max_turns');
    expect(result.turns).toBe(3);
  });

  it('应支持 beforeRun/afterRun 两个 invoke 外钩子', async () => {
    const events: string[] = [];
    let preRunId = '';

    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgentRunner({model});

    const result = await runner.invoke(
      {messages: [new HumanMessage('start')]},
      {
        recursionLimit: 3,
        beforeRun: (context) => {
          preRunId = context.runId;
          events.push(`pre:${context.maxTurns}`);
        },
        afterRun: (context) => {
          expect(context.runId).toBe(preRunId);
          events.push(`post:${context.result.reason}:${context.result.turns}`);
        }
      }
    );

    expect(result.reason).toBe('complete');
    expect(events).toEqual(['pre:3', 'post:complete:1']);
  });

  it('beforeRun 抛错时应直接返回 error', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgentRunner({model});

    const result = await runner.invoke(
      {messages: [new HumanMessage('start')]},
      {
        beforeRun: () => {
          throw new Error('pre boom');
        }
      }
    );

    expect(result.reason).toBe('error');
    expect(result.turns).toBe(0);
    expect(result.error?.message).toContain('beforeRun failed: pre boom');
  });

  it('afterRun 抛错时应将非 error 结果转为 error', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgentRunner({model});

    const result = await runner.invoke(
      {messages: [new HumanMessage('start')]},
      {
        afterRun: () => {
          throw new Error('post boom');
        }
      }
    );

    expect(result.reason).toBe('error');
    expect(result.error?.message).toContain('afterRun failed: post boom');
  });

  it('当结果已是 error 时，afterRun 抛错不应覆盖原错误', async () => {
    const model = {
      invoke: async () => {
        throw new Error('model boom');
      },
      bindTools: () => ({
        invoke: async () => {
          throw new Error('model boom');
        }
      })
    } as unknown as BaseChatModel;

    const runner = createAgentRunner({model});
    const result = await runner.invoke(
      {messages: [new HumanMessage('start')]},
      {
        afterRun: () => {
          throw new Error('post boom');
        }
      }
    );

    expect(result.reason).toBe('error');
    expect(result.error?.message).toBe('model boom');
  });

  it('handleToolErrors=false 时工具失败应向上抛出异常并收敛为 error', async () => {
    const toolCall: ToolCall = {id: 'call_err', name: 'echo', args: {}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => {
        throw new Error('tool boom');
      }
    } as unknown as StructuredToolInterface;

    const responses: AIMessage[] = [new AIMessage({content: '', tool_calls: [toolCall]})];
    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const runner = createAgentRunner({model, tools: [tool], handleToolErrors: false});

    const result = await runner.invoke({messages: [new HumanMessage('start')]});
    expect(result.reason).toBe('error');
    expect(result.error?.message).toContain('Tool "echo" execution failed');
  });

  it('应支持 6 hooks middleware 编排', async () => {
    const events: string[] = [];
    const toolCall: ToolCall = {id: 'call_mw', name: 'echo', args: {}};
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

    const middlewares: BaseMiddleware[] = [
      {
        name: 'trace',
        beforeAgent: (context) => {
          events.push(`beforeAgent:${context.turn}`);
        },
        beforeModel: (context) => {
          events.push(`beforeModel:${context.turn}`);
        },
        wrapModelCall: async (context, next) => {
          events.push(`wrapModel:start:${context.turn}`);
          const response = await next();
          events.push(`wrapModel:end:${context.turn}`);
          return response;
        },
        afterModel: (context) => {
          events.push(`afterModel:${context.turn}`);
        },
        wrapToolCall: async (context, next) => {
          events.push(`wrapTool:start:${context.turn}:${context.toolCall.name}`);
          const response = await next();
          events.push(`wrapTool:end:${context.turn}:${context.toolCall.name}`);
          return response;
        },
        afterAgent: (context) => {
          events.push(`afterAgent:${context.result.reason}`);
        }
      }
    ];

    const runner = createAgentRunner({model, tools: [tool], middlewares});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    expect(events).toEqual([
      'beforeAgent:1',
      'beforeModel:1',
      'wrapModel:start:1',
      'wrapModel:end:1',
      'afterModel:1',
      'wrapTool:start:1:echo',
      'wrapTool:end:1:echo',
      'afterAgent:continue',
      'beforeAgent:2',
      'beforeModel:2',
      'wrapModel:start:2',
      'wrapModel:end:2',
      'afterModel:2',
      'afterAgent:complete'
    ]);
  });

  it('afterModel 抛错时应在该轮返回 error 且不执行工具', async () => {
    const toolCall: ToolCall = {id: 'call_err_stage', name: 'echo', args: {}};
    const model = new FakeModel([new AIMessage({content: '', tool_calls: [toolCall]})]) as unknown as BaseChatModel;

    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const runner = createAgentRunner({
      model,
      tools: [tool],
      middlewares: [
        {
          name: 'fail_after_model',
          afterModel: () => {
            throw new Error('afterModel boom');
          }
        }
      ]
    });

    const result = await runner.invoke({messages: [new HumanMessage('start')]});
    expect(result.reason).toBe('error');
    expect(result.error?.message).toContain('afterModel boom');
    const hasToolMessage = result.state.messages.some((message) => message instanceof ToolMessage);
    expect(hasToolMessage).toBe(false);
  });
});

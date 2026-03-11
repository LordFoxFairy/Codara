import {describe, expect, it} from 'bun:test';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type ToolCall
} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents';
import {createHILMiddleware, createMiddleware, type BaseMiddleware} from '@core/middleware';
import {z} from 'zod';

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

class StreamingModel extends FakeModel {
  constructor(
    responses: AIMessage[],
    private readonly streamedChunks: AIMessageChunk[][]
  ) {
    super(responses);
  }

  async stream(messages: BaseMessage[]): Promise<AsyncGenerator<AIMessageChunk>> {
    void messages;
    const chunks = this.streamedChunks.shift();
    if (!chunks) {
      throw new Error('No fake stream response available');
    }

    return (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }
}

describe('Agent', () => {
  it('支持直接以字符串作为输入', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const agent = createAgent({model});

    const result = await agent.invoke('hello');

    expect(result.reason).toBe('complete');
    expect(result.state.messages).toHaveLength(2);
    expect(result.state.messages[0]).toBeInstanceOf(HumanMessage);
    expect(String(result.state.messages[0]?.content)).toBe('hello');
  });

  it('无 tool_calls 时应直接 complete', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const agent = createAgent({model});

    const result = await agent.invoke({messages: [new HumanMessage('hello')]});

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
    const agent = createAgent({model, tools: [tool]});
    const result = await agent.invoke({messages: [new HumanMessage('start')]});

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
    const agent = createAgent({model});
    const result = await agent.invoke({messages: [new HumanMessage('start')]});

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
    const runner = createAgent({model, tools: [tool]});
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
    const runner = createAgent({model, tools: [tool]});
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

    const runner = createAgent({model});
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

    const runner = createAgent({model, tools: [tool]});
    const result = await runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 3});

    expect(result.reason).toBe('max_turns');
    expect(result.turns).toBe(3);
  });

  it('afterAgent 的 turn 级结果应保持 continue，而最终 max_turns 只由 run 结果拥有', async () => {
    const events: string[] = [];
    const toolCall: ToolCall = {id: 'call_loop_ownership', name: 'echo', args: {}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong'
    } as unknown as StructuredToolInterface;

    const model = new FakeModel(
      Array.from({length: 10}, () => new AIMessage({content: '', tool_calls: [toolCall]}))
    ) as unknown as BaseChatModel;

    const runner = createAgent({
      model,
      tools: [tool],
      middleware: [
        {
          name: 'max_turns_probe',
          afterAgent: (context) => {
            events.push(`turn:${context.execution.turn}:${context.result.reason}`);
          },
        },
      ],
    });

    const result = await runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 2});

    expect(result.reason).toBe('max_turns');
    expect(result.turns).toBe(2);
    expect(events).toEqual([
      'turn:1:continue',
      'turn:2:continue',
    ]);
  });

  it('非法 recursionLimit 不应污染 agent 内部状态', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgent({model});

    await expect(
      runner.invoke({messages: [new HumanMessage('start')]}, {recursionLimit: 0})
    ).rejects.toThrow('recursionLimit must be at least 1');

    const state = runner.getState();
    expect(state.status).toBe('idle');
    expect(state.messages).toHaveLength(0);
  });

  it('应支持 beforeRun/afterRun 两个 invoke 外钩子', async () => {
    const events: string[] = [];
    let preRunId = '';

    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgent({model});

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
    const runner = createAgent({model});

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
    expect(runner.getState().status).toBe('idle');
    expect(runner.getState().messages).toHaveLength(0);
  });

  it('afterRun 抛错时应将非 error 结果转为 error', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgent({model});

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

    const runner = createAgent({model});
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
    const runner = createAgent({model, tools: [tool], handleToolErrors: false});

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
          events.push(`beforeAgent:${context.execution.turn}`);
        },
        beforeModel: (context) => {
          events.push(`beforeModel:${context.execution.turn}`);
        },
        wrapModelCall: async (context, next) => {
          events.push(`wrapModel:start:${context.execution.turn}`);
          const response = await next();
          events.push(`wrapModel:end:${context.execution.turn}`);
          return response;
        },
        afterModel: (context) => {
          events.push(`afterModel:${context.execution.turn}`);
        },
        wrapToolCall: async (context, next) => {
          events.push(`wrapTool:start:${context.execution.turn}:${context.toolCall.name}`);
          const response = await next();
          events.push(`wrapTool:end:${context.execution.turn}:${context.toolCall.name}`);
          return response;
        },
        afterAgent: (context) => {
          events.push(`afterAgent:${context.result.reason}`);
        }
      }
    ];

    const runner = createAgent({model, tools: [tool], middleware: middlewares});
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

  it('runtimeShared 应在同一次 run 的多轮之间保持可见', async () => {
    const events: string[] = [];
    const toolCall: ToolCall = {id: 'call_shared', name: 'echo', args: {}};
    const responses: AIMessage[] = [
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ];
    const model = new FakeModel(responses) as unknown as BaseChatModel;
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong',
    } as unknown as StructuredToolInterface;

    const runner = createAgent({
      model,
      tools: [tool],
      middleware: [
        {
          name: 'runtime_shared_probe',
          beforeModel: (context) => {
            events.push(`shared:${context.execution.turn}:${String(context.runtime.shared?.flag ?? 'none')}`);
            if (context.execution.turn === 1) {
              return {
                runtimeShared: {
                  flag: 'ready',
                },
              };
            }
            return undefined;
          },
        },
      ],
    });

    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    expect(events).toEqual([
      'shared:1:none',
      'shared:2:ready',
    ]);
  });

  it('应支持 middleware 单数入参别名', async () => {
    const order: string[] = [];
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const aliasMiddleware = createMiddleware({
      name: 'AliasMiddleware',
      beforeModel: () => {
        order.push('beforeModel');
      },
    });

    const runner = createAgent({
      model,
      middleware: [aliasMiddleware],
    });

    const result = await runner.invoke({messages: [new HumanMessage('hello')]});

    expect(result.reason).toBe('complete');
    expect(order).toEqual(['beforeModel']);
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

    const runner = createAgent({
      model,
      tools: [tool],
      middleware: [
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

  it('应支持在 wrapModelCall 中通过 runtime.context 注入 systemMessage', async () => {
    const capturedInvocations: BaseMessage[][] = [];
    const model = {
      invoke: async (messages: BaseMessage[]) => {
        capturedInvocations.push(messages);
        return new AIMessage('done');
      },
      bindTools: () => ({
        invoke: async (messages: BaseMessage[]) => {
          capturedInvocations.push(messages);
          return new AIMessage('done');
        }
      })
    } as unknown as BaseChatModel;

    const userContextMiddleware = createMiddleware({
      name: 'UserContextMiddleware',
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string()
      }),
      wrapModelCall: (request, handler) => {
        const userId = String(request.runtime.context.userId);
        const tenantId = String(request.runtime.context.tenantId);
        const contextText = `User ID: ${userId}, Tenant: ${tenantId}`;
        return handler({
          ...request,
          systemMessage: request.systemMessage.concat(contextText)
        });
      }
    });

    const runner = createAgent({
      model,
      middleware: [userContextMiddleware]
    });

    const result = await runner.invoke(
      {messages: [new HumanMessage('hello')]},
      {
        context: {
          userId: 'user-123',
          tenantId: 'acme-corp'
        }
      }
    );

    expect(result.reason).toBe('complete');
    const firstInvoke = capturedInvocations[0] ?? [];
    expect(firstInvoke[0]).toBeInstanceOf(SystemMessage);
    expect(String((firstInvoke[0] as SystemMessage).content)).toContain('User ID: user-123, Tenant: acme-corp');
  });

  it('应区分持久 context、临时 runtimeContext 和合成后的有效 context', async () => {
    let seen:
      | {
          context: Record<string, unknown>;
          durableContext: Record<string, unknown>;
          runtimeContext: Record<string, unknown>;
          execution: {threadId?: string};
        }
      | undefined;

    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const middleware = createMiddleware({
      name: 'ContextBoundaryMiddleware',
      beforeModel: (context) => {
        seen = {
          context: context.runtime.context,
          durableContext: context.state.context ?? {},
          runtimeContext: context.runtime.runtimeContext ?? {},
          execution: context.execution ?? {},
        };
      },
    });

    const runner = createAgent({
      model,
      context: {
        tenantId: 'tenant-1',
        profile: {
          locale: 'zh-CN',
        },
      },
      middleware: [middleware],
    });

    const result = await runner.invoke('hello', {
      context: {
        userId: 'user-123',
        profile: {
          timezone: 'Asia/Shanghai',
        },
      },
    });

    expect(result.reason).toBe('complete');
    expect(seen?.context).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-123',
      profile: {
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
    });
    expect(seen?.durableContext).toEqual({
      tenantId: 'tenant-1',
      profile: {
        locale: 'zh-CN',
      },
    });
    expect(seen?.runtimeContext).toEqual({
      userId: 'user-123',
      profile: {
        timezone: 'Asia/Shanghai',
      },
    });
    expect(result.state.context).toEqual({
      tenantId: 'tenant-1',
      profile: {
        locale: 'zh-CN',
      },
    });
    expect(seen?.execution.threadId).toBe(result.state.threadId);
  });

  it('应将 threadId/runId/requestId/toolCallId 暴露给工具调用元数据', async () => {
    let seenConfigurable: Record<string, unknown> | undefined;
    let seenMetadata: Record<string, unknown> | undefined;
    const toolCall: ToolCall = {id: 'call_ids', name: 'echo', args: {text: 'ping'}};
    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async (_args: unknown, config?: {configurable?: Record<string, unknown>; metadata?: Record<string, unknown>}) => {
        seenConfigurable = config?.configurable;
        seenMetadata = config?.metadata;
        return 'pong';
      },
    } as unknown as StructuredToolInterface;

    const runner = createAgent({model, tools: [tool], threadId: 'thread-tool-ids'});
    const result = await runner.invoke({messages: [new HumanMessage('start')]});

    expect(result.reason).toBe('complete');
    expect(seenConfigurable?.execution).toEqual({
      threadId: 'thread-tool-ids',
      runId: expect.any(String),
      turn: 1,
      maxTurns: 25,
      requestId: expect.stringContaining(':turn:1:tool:call_ids'),
      toolIndex: 0,
      toolCallId: 'call_ids',
    });
    expect(seenMetadata?.execution).toEqual({
      threadId: 'thread-tool-ids',
      runId: expect.any(String),
      turn: 1,
      maxTurns: 25,
      requestId: expect.stringContaining(':turn:1:tool:call_ids'),
      toolIndex: 0,
      toolCallId: 'call_ids',
    });
  });

  it('contextSchema 校验应基于持久 context 与临时 context 的合成结果', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const userContextMiddleware = createMiddleware({
      name: 'MergedContextValidationMiddleware',
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string(),
      }),
      beforeModel: () => undefined,
    });

    const runner = createAgent({
      model,
      context: {
        tenantId: 'tenant-1',
      },
      middleware: [userContextMiddleware],
    });

    const result = await runner.invoke(
      {messages: [new HumanMessage('hello')]},
      {
        context: {
          userId: 'user-123',
        },
      }
    );

    expect(result.reason).toBe('complete');
  });

  it('context 不满足 middleware.contextSchema 时应返回 error', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const userContextMiddleware = createMiddleware({
      name: 'UserContextMiddleware',
      contextSchema: z.object({
        userId: z.string(),
        tenantId: z.string()
      }),
      beforeModel: () => undefined
    });

    const runner = createAgent({
      model,
      middleware: [userContextMiddleware]
    });

    const result = await runner.invoke(
      {messages: [new HumanMessage('hello')]},
      {
        context: {
          userId: 'user-123'
        }
      }
    );

    expect(result.reason).toBe('error');
    expect(result.error?.message).toContain('context validation failed');
    expect(runner.getState().status).toBe('idle');
    expect(runner.getState().messages).toHaveLength(0);
  });

  it('HIL pause 应在当前 turn 结束运行，而不是继续消耗后续 turn', async () => {
    const toolCall: ToolCall = {id: 'call_pause_stop', name: 'bash', args: {command: 'git status'}};
    let invocations = 0;
    let bashInvokeCount = 0;
    const model = {
      invoke: async () => {
        invocations += 1;
        return new AIMessage({content: '', tool_calls: [toolCall]});
      },
      bindTools: () => ({
        invoke: async () => {
          invocations += 1;
          return new AIMessage({content: '', tool_calls: [toolCall]});
        }
      })
    } as unknown as BaseChatModel;

    const bashTool = {
      name: 'bash',
      description: 'bash',
      schema: {} as never,
      invoke: async () => {
        bashInvokeCount += 1;
        return 'executed';
      },
    } as unknown as StructuredToolInterface;

    const runner = createAgent({
      model,
      tools: [bashTool],
      middleware: [
        createHILMiddleware({
          interruptOn: {
            bash: true,
          },
        }),
      ],
    });

    const result = await runner.invoke({messages: [new HumanMessage('run git status')]});

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(1);
    expect(result.state.status).toBe('paused');
    expect(result.state.pendingPause?.action.toolName).toBe('bash');
    expect(invocations).toBe(1);
    expect(bashInvokeCount).toBe(0);
  });

  it('HIL pause 应阻止同一 turn 后续的 serial tool batches 继续执行', async () => {
    const bashCall: ToolCall = {id: 'call_pause_then_stop', name: 'bash', args: {command: 'git status'}};
    const echoCall: ToolCall = {id: 'call_should_not_run', name: 'echo', args: {text: 'after pause'}};
    let echoInvokeCount = 0;
    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [bashCall, echoCall]}),
    ]) as unknown as BaseChatModel;

    const bashTool = {
      name: 'bash',
      description: 'bash',
      schema: {} as never,
      invoke: async () => 'executed',
    } as unknown as StructuredToolInterface;
    const echoTool = {
      name: 'echo',
      description: 'echo',
      schema: {} as never,
      invoke: async () => {
        echoInvokeCount += 1;
        return 'should not happen';
      },
    } as unknown as StructuredToolInterface;

    const runner = createAgent({
      model,
      tools: [bashTool, echoTool],
      middleware: [
        createHILMiddleware({
          interruptOn: {
            bash: true,
          },
        }),
      ],
    });

    const result = await runner.invoke({messages: [new HumanMessage('run guarded tools')]});

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(1);
    expect(result.state.status).toBe('paused');
    expect(result.state.pendingPause?.action.toolName).toBe('bash');
    expect(echoInvokeCount).toBe(0);
    expect(result.state.messages.some((message) => message instanceof ToolMessage && message.tool_call_id === 'call_should_not_run')).toBe(false);
  });

  it('stream(messages) 应输出模型 chunks 并返回最终结果', async () => {
    const model = new StreamingModel(
      [new AIMessage('hello')],
      [[new AIMessageChunk({content: 'he'}), new AIMessageChunk({content: 'llo'})]]
    ) as unknown as BaseChatModel;
    const runner = createAgent({model});

    const stream = runner.stream({messages: [new HumanMessage('hello')]}, {streamMode: 'messages'});
    const chunks: AIMessageChunk[] = [];
    let result: Awaited<ReturnType<typeof runner.invoke>> | undefined;

    while (true) {
      const next = await stream.next();
      if (next.done) {
        result = next.value;
        break;
      }
      chunks.push(next.value as AIMessageChunk);
    }

    expect(chunks).toHaveLength(2);
    expect(String(chunks[0]?.content)).toBe('he');
    expect(String(chunks[1]?.content)).toBe('llo');
    expect(chunks[0]?.response_metadata.threadId).toBe(result?.state.threadId);
    expect(typeof chunks[0]?.response_metadata.runId).toBe('string');
    expect(chunks[0]?.response_metadata.requestId).toBe(`${chunks[0]?.response_metadata.runId}:turn:1`);
    expect(chunks[0]?.response_metadata.turn).toBe(1);
    expect(result?.reason).toBe('complete');
    expect(String(result?.state.messages[result.state.messages.length - 1]?.content)).toBe('hello');
  });

  it('stream(updates) 应输出 model/tool 步骤更新', async () => {
    const toolCall: ToolCall = {id: 'call_stream', name: 'echo', args: {text: 'ping'}};
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong',
    } as unknown as StructuredToolInterface;

    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const runner = createAgent({model, tools: [tool]});
    const updates: Array<{model?: {messages: [AIMessage]}; tools?: {messages: [ToolMessage]}}> = [];

    for await (const chunk of runner.stream({messages: [new HumanMessage('start')]}, {streamMode: 'updates'})) {
      updates.push(chunk as {model?: {messages: [AIMessage]}; tools?: {messages: [ToolMessage]}});
    }

    expect(updates).toHaveLength(3);
    expect(updates[0]?.model?.messages[0]).toBeInstanceOf(AIMessage);
    expect(updates[1]?.tools?.messages[0]).toBeInstanceOf(ToolMessage);
    expect(String(updates[1]?.tools?.messages[0]?.content)).toBe('pong');
    expect((updates[1]?.tools?.messages[0] as ToolMessage)?.artifact).toBe('pong');
    expect(String(updates[2]?.model?.messages[0]?.content)).toBe('done');
  });

  it('stream(values) 应输出完整 messages 快照', async () => {
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const runner = createAgent({model});
    const values: Array<{messages: BaseMessage[]}> = [];

    for await (const chunk of runner.stream({messages: [new HumanMessage('hello')]}, {streamMode: 'values'})) {
      values.push(chunk as {messages: BaseMessage[]});
    }

    expect(values).toHaveLength(2);
    expect(values[0]?.messages).toHaveLength(1);
    expect(values[1]?.messages).toHaveLength(2);
    expect(String(values[1]?.messages[1]?.content)).toBe('done');
  });

  it('stream(custom) 应输出 HIL 自定义事件', async () => {
    const toolCall: ToolCall = {id: 'call_pause', name: 'bash', args: {command: 'git status'}};
    const bashTool = {
      name: 'bash',
      description: 'bash',
      schema: {} as never,
      invoke: async () => 'executed',
    } as unknown as StructuredToolInterface;

    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const hil = createMiddleware({
      name: 'hil-test-wrapper',
      wrapToolCall: async (context) => {
        return new ToolMessage({
          content: JSON.stringify({
            type: 'hil_pause',
            request: {
              id: 'pause_1',
              description: 'Confirm bash command',
              action: {
                toolName: 'bash',
                toolCallId: context.toolCall.id ?? 'call_pause',
                toolArgs: context.toolCall.args,
              },
              review: {decision: 'ask', allowedDecisions: ['approve', 'reject']},
              runtime: {
                runId: context.execution.runId,
                requestId: context.execution.requestId,
                turn: context.execution.turn,
              },
            },
          }),
          tool_call_id: context.toolCall.id ?? 'call_pause',
        });
      },
    });

    const runner = createAgent({model, tools: [bashTool], middleware: [hil]});
    const events: Array<{type: string; payload: {type: string}}> = [];

    for await (const chunk of runner.stream({messages: [new HumanMessage('run git status')]}, {streamMode: 'custom'})) {
      events.push(chunk as {type: string; payload: {type: string}});
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('hil_event');
    expect(events[0]?.payload.type).toBe('hil_pause');
  });
});

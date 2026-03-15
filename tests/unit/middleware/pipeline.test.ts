import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseMiddleware} from '@engine/pipeline';
import {MiddlewarePipeline} from '@engine/pipeline/pipeline';
import {z} from 'zod';

function createBaseContext() {
  const messages = [new HumanMessage('hello')] as BaseMessage[];
  return {
    state: {messages, context: {}, values: {}},
    messages,
    runtime: {context: {}, runtimeContext: {}, shared: {}},
    systemMessage: [],
    execution: {
      sessionId: 'thread_1',
      runId: 'run_1',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_1',
    },
  };
}

describe('MiddlewarePipeline', () => {
  it('should run before/after lifecycle hooks in registration order', async () => {
    const events: string[] = [];
    const middlewares: BaseMiddleware[] = [
      {
        name: 'mw_a',
        beforeAgent: () => {
          events.push('a:beforeAgent');
        },
        beforeModel: () => {
          events.push('a:beforeModel');
        },
        afterModel: () => {
          events.push('a:afterModel');
        },
        afterAgent: () => {
          events.push('a:afterAgent');
        },
      },
      {
        name: 'mw_b',
        beforeAgent: () => {
          events.push('b:beforeAgent');
        },
        beforeModel: () => {
          events.push('b:beforeModel');
        },
        afterModel: () => {
          events.push('b:afterModel');
        },
        afterAgent: () => {
          events.push('b:afterAgent');
        },
      },
    ];

    const pipeline = new MiddlewarePipeline(middlewares);
    const context = createBaseContext();

    await pipeline.beforeAgent(context);
    await pipeline.beforeModel(context);
    await pipeline.afterModel({...context, response: new AIMessage('ok')});
    await pipeline.afterAgent({...context, result: {reason: 'complete', turns: 1}});

    expect(events).toEqual([
      'a:beforeAgent',
      'b:beforeAgent',
      'a:beforeModel',
      'b:beforeModel',
      'a:afterModel',
      'b:afterModel',
      'a:afterAgent',
      'b:afterAgent',
    ]);
  });

  it('should run wrapModelCall as onion middleware', async () => {
    const events: string[] = [];
    const pipeline = new MiddlewarePipeline([
      {
        name: 'outer',
        wrapModelCall: async (_context, next) => {
          events.push('outer:start');
          const result = await next();
          events.push('outer:end');
          return result;
        },
      },
      {
        name: 'inner',
        wrapModelCall: async (_context, next) => {
          events.push('inner:start');
          const result = await next();
          events.push('inner:end');
          return result;
        },
      },
    ]);

    const response = await pipeline.wrapModelCall(createBaseContext(), async () => {
      events.push('handler');
      return new AIMessage('done');
    });

    expect(response.content).toBe('done');
    expect(events).toEqual(['outer:start', 'inner:start', 'handler', 'inner:end', 'outer:end']);
  });

  it('should support wrapToolCall short-circuit', async () => {
    const events: string[] = [];
    const toolCall: ToolCall = {
      id: 'call_1',
      name: 'echo',
      args: {},
    };

    const pipeline = new MiddlewarePipeline([
      {
        name: 'short_circuit',
        wrapToolCall: async (context) => {
          events.push(`short:${context.toolCall.name}`);
          return new ToolMessage({content: 'blocked', tool_call_id: context.toolCall.id!});
        },
      },
      {
        name: 'never_reached',
        wrapToolCall: async (_context, next) => {
          events.push('never');
          return await next();
        },
      },
    ]);

    const result = await pipeline.wrapToolCall({...createBaseContext(), toolCall, toolIndex: 0}, async () => {
      events.push('handler');
      return new ToolMessage({content: 'ok', tool_call_id: toolCall.id!});
    });

    expect(result.content).toBe('blocked');
    expect(events).toEqual(['short:echo']);
  });

  it('should allow retry-style sequential next() calls in wrap hooks', async () => {
    const events: string[] = [];
    const pipeline = new MiddlewarePipeline([
      {
        name: 'retry_like',
        wrapModelCall: async (_context, next) => {
          events.push('attempt:1');
          try {
            await next();
          } catch {
            events.push('retry');
          }
          events.push('attempt:2');
          return await next();
        },
      },
    ]);

    let attempts = 0;
    const response = await pipeline.wrapModelCall(createBaseContext(), async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('transient');
      }
      return new AIMessage('ok');
    });

    expect(String(response.content)).toBe('ok');
    expect(attempts).toBe(2);
    expect(events).toEqual(['attempt:1', 'retry', 'attempt:2']);
  });

  it('should throw when next() is called concurrently in wrap hooks', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'invalid_concurrent',
        wrapModelCall: async (_context, next) => {
          const results = await Promise.allSettled([next(), next()]);
          const rejected = results.find((result) => result.status === 'rejected');
          if (rejected && rejected.status === 'rejected') {
            throw rejected.reason;
          }
          const first = results[0];
          if (first?.status === 'fulfilled') {
            return first.value;
          }
          throw new Error('Expected first result to be fulfilled');
        },
      },
    ]);

    await expect(async () => {
      await pipeline.wrapModelCall(createBaseContext(), async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new AIMessage('ok');
      });
    }).toThrow('next() called concurrently');
  });

  it('should include middleware name and stage when before hook throws', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'guard',
        beforeModel: () => {
          throw new Error('blocked');
        },
      },
    ]);

    await expect(async () => {
      await pipeline.beforeModel(createBaseContext());
    }).toThrow('Middleware "guard" failed in beforeModel: blocked');
  });

  it('should keep durable and runtime context views synchronized across middleware hooks', async () => {
    const seen: Array<{
      effective: Record<string, unknown>;
      runtimeContext: Record<string, unknown>;
      durableContext: Record<string, unknown>;
    }> = [];

    const pipeline = new MiddlewarePipeline([
      {
        name: 'runtime_data',
        beforeAgent: () => ({
          context: {
            tenantId: 'tenant-1',
          },
          runtimeContext: {
            skills: {
              loaded: true,
            },
          },
        }),
      },
      {
        name: 'runtime_data_reader',
        beforeAgent: (context) => {
          seen.push({
            effective: {...context.runtime.context},
            runtimeContext: {...(context.runtime.runtimeContext ?? {})},
            durableContext: {...(context.state.context ?? {})},
          });
        },
      },
    ]);

    const context = createBaseContext();
    await pipeline.beforeAgent(context);

    expect(context.runtime.context).toEqual({
      tenantId: 'tenant-1',
      skills: {
        loaded: true,
      },
    });
    expect(context.runtime.runtimeContext).toEqual({
      skills: {
        loaded: true,
      },
    });
    expect(context.state.context).toEqual({
      tenantId: 'tenant-1',
    });
    expect(seen).toEqual([
      {
        effective: {
          tenantId: 'tenant-1',
          skills: {
            loaded: true,
          },
        },
        runtimeContext: {
          skills: {
            loaded: true,
          },
        },
        durableContext: {
          tenantId: 'tenant-1',
        },
      },
    ]);
  });

  it('should include middleware name and stage when wrap hook throws', async () => {
    const toolCall: ToolCall = {
      id: 'call_wrap_error',
      name: 'echo',
      args: {},
    };

    const pipeline = new MiddlewarePipeline([
      {
        name: 'trace',
        wrapToolCall: async (_context, next) => {
          const result = await next();
          return result;
        },
      },
      {
        name: 'failing_wrap',
        wrapToolCall: async () => {
          throw new Error('wrap boom');
        },
      },
    ]);

    await expect(async () => {
      await pipeline.wrapToolCall({...createBaseContext(), toolCall, toolIndex: 0}, async () => {
        return new ToolMessage({content: 'ok', tool_call_id: toolCall.id!});
      });
    }).toThrow('Middleware "failing_wrap" failed in wrapToolCall: wrap boom');
  });

  it('should expose an immutable middleware registry snapshot', () => {
    const pipeline = new MiddlewarePipeline([
      {name: 'safety', required: true, beforeAgent: () => undefined},
      {name: 'logging', beforeModel: () => undefined},
    ]);

    expect(pipeline.list().map((middleware) => middleware.name)).toEqual(['safety', 'logging']);
    expect(pipeline.has('safety')).toBe(true);
    expect(pipeline.get('logging')?.name).toBe('logging');
  });

  it('should reject duplicate middleware names and invalid definitions', () => {
    expect(() => new MiddlewarePipeline([
      {name: 'dup', beforeModel: () => undefined},
      {name: 'dup', beforeAgent: () => undefined},
    ])).toThrow('Duplicate middleware name');

    expect(() => new MiddlewarePipeline([
      {name: '   ', beforeModel: () => undefined},
    ])).toThrow('name cannot be empty');

    expect(() => new MiddlewarePipeline([
      {name: 'empty'},
    ])).toThrow('must define at least one lifecycle hook');
  });

  it('should validate invoke context with middleware contextSchema', () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'ctx_guard',
        contextSchema: z.object({
          userId: z.string(),
          tenantId: z.string()
        }),
        beforeModel: () => undefined
      }
    ]);

    expect(() => {
      pipeline.validateContext({userId: 'user-1'});
    }).toThrow('context validation failed');

    expect(() => {
      pipeline.validateContext({userId: 'user-1', tenantId: 'tenant-1'});
    }).not.toThrow();
  });

  it('should normalize middleware state updates through stateSchema defaults', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'state_guard',
        stateSchema: z.object({
          todos: z.array(z.string()).default([]),
          active: z.boolean().default(false),
        }),
        beforeModel: () => ({
          values: {
            active: true,
          },
        }),
      },
    ]);

    const context = createBaseContext();
    await pipeline.beforeModel(context);

    expect(context.state.values).toEqual({
      todos: [],
      active: true,
    });
  });

  it('should reject invalid middleware state updates', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'state_guard',
        stateSchema: z.object({
          todos: z.array(z.string()).default([]),
        }),
        beforeModel: () => ({
          values: {
            todos: 'invalid',
          },
        }),
      },
    ]);

    await expect(async () => {
      await pipeline.beforeModel(createBaseContext());
    }).toThrow('Middleware "state_guard" failed in beforeModel: Middleware "state_guard" state validation failed');
  });

  it('should reject reserved agent state keys written through context updates', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'bad_context',
        beforeModel: () => ({
          context: {
            todos: [{content: 'wrong place'}],
          },
        }),
      },
    ]);

    await expect(async () => {
      await pipeline.beforeModel(createBaseContext());
    }).toThrow('Middleware "bad_context" failed in beforeModel: "todos" is reserved for agent state');
  });
});

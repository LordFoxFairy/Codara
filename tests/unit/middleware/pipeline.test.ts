import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {MiddlewarePipeline, type BaseMiddleware} from '@core/middleware';

function createBaseContext() {
  return {
    state: {messages: [new HumanMessage('hello')] as BaseMessage[]},
    runId: 'run_1',
    turn: 1,
    maxTurns: 3,
    requestId: 'req_1'
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

  it('should throw when next() is called multiple times in wrap hooks', async () => {
    const pipeline = new MiddlewarePipeline([
      {
        name: 'invalid',
        wrapModelCall: async (_context, next) => {
          await next();
          return await next();
        },
      },
    ]);

    await expect(async () => {
      await pipeline.wrapModelCall(createBaseContext(), async () => new AIMessage('ok'));
    }).toThrow('next() called multiple times');
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

  it('should prevent removing required middleware', () => {
    const pipeline = new MiddlewarePipeline([
      {name: 'safety', required: true, beforeAgent: () => undefined},
      {name: 'logging', beforeModel: () => undefined},
    ]);

    expect(() => pipeline.remove('safety')).toThrow('Cannot remove required middleware');

    pipeline.remove('logging');
    expect(pipeline.list().map((m) => m.name)).toEqual(['safety']);
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
});

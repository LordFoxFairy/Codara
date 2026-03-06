import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {createHILMiddleware, type ToolCallContext} from '@core/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown>): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    runId: 'run_hil_route_1',
    turn: 1,
    maxTurns: 3,
    requestId: 'req_hil_route_1',
    toolCall,
    toolIndex: 0,
  };
}

describe('HIL resume routing', () => {
  it('should resolve resume by pause request id', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {bash: true},
      handleResume: async (_req, payload, context, handler) => {
        return handler({
          ...context,
          toolCall: {
            ...context.toolCall,
            args: {
              ...(context.toolCall.args as Record<string, unknown>),
              marker: (payload as {marker: string}).marker,
            },
          },
        });
      },
    });

    const toolCall: ToolCall = {id: 'call_route_1', name: 'bash', args: {command: 'git status'}};
    const pauseId = 'run_hil_route_1:1:call_route_1';

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resumes: {
            [pauseId]: {marker: 'by-id'},
          },
        },
      }),
      async (request) => {
        const marker = (request?.toolCall.args as {marker?: string}).marker ?? 'none';
        return new ToolMessage({content: `marker:${marker}`, tool_call_id: 'call_route_1'});
      }
    );

    expect(String(result?.content)).toBe('marker:by-id');
  });

  it('should resolve resume by tool call id when pause id is absent', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {bash: true},
      handleResume: async (_req, payload, context, handler) => {
        return handler({
          ...context,
          toolCall: {
            ...context.toolCall,
            args: {
              ...(context.toolCall.args as Record<string, unknown>),
              marker: (payload as {marker: string}).marker,
            },
          },
        });
      },
    });

    const toolCall: ToolCall = {id: 'call_route_2', name: 'bash', args: {command: 'git status'}};

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resumes: {
            call_route_2: {marker: 'by-call-id'},
          },
        },
      }),
      async (request) => {
        const marker = (request?.toolCall.args as {marker?: string}).marker ?? 'none';
        return new ToolMessage({content: `marker:${marker}`, tool_call_id: 'call_route_2'});
      }
    );

    expect(String(result?.content)).toBe('marker:by-call-id');
  });

  it('should emit pause payload when no resume exists', async () => {
    const middleware = createHILMiddleware({
      interruptOn: {bash: true},
    });

    const toolCall: ToolCall = {id: 'call_route_3', name: 'bash', args: {command: 'git status'}};
    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {}),
      async () => new ToolMessage({content: 'should-not-run', tool_call_id: 'call_route_3'})
    );

    expect(String(result?.content)).toContain('"type":"hil_pause"');
  });
});

import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {ASK_USER_TOOL_NAME, createInteractionMiddleware, parseAskUserResult, parseHILToolMessagePayload, type ToolCallContext} from '@core/middleware';

function createToolContext(toolCall: ToolCall, runtimeContext: Record<string, unknown> = {}): ToolCallContext {
  const messages = [new HumanMessage('run')] as BaseMessage[];
  return {
    state: {messages},
    messages,
    runtime: {context: runtimeContext},
    systemMessage: [],
    execution: {
      sessionId: 'session_interaction_mw_1',
      runId: 'run_interaction_mw_1',
      turn: 1,
      maxTurns: 3,
      requestId: 'req_interaction_mw_1',
      toolIndex: 0,
      toolCallId: toolCall.id ?? 'tool_0',
    },
    toolCall,
    toolIndex: 0,
  };
}

describe('createInteractionMiddleware', () => {
  it('should pause AskUser tool calls with generic form UI metadata', async () => {
    const middleware = createInteractionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_pause_1',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: 'Need a short product brief.',
        questions: [
          {
            id: 'domain',
            label: 'Product Domain',
            question: 'Which domain?',
            input: 'select',
            options: [{id: 'saas', label: 'SaaS'}],
          },
        ],
      },
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_pause_1'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    expect(payload?.type === 'hil_pause' ? payload.request.channel : '').toBe('interaction-center');
    expect(payload?.type === 'hil_pause' ? payload.request.ui?.form?.tabs[0]?.label : '').toBe('Product Domain');
    expect(payload?.type === 'hil_pause' ? payload.request.ui?.form?.tabs[0] : undefined).toMatchObject({input: 'select'});
  });

  it('should convert a resumed AskUser pause into a structured tool result', async () => {
    const middleware = createInteractionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_resume_1',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: 'Need a short product brief.',
        questions: [{id: 'domain', label: 'Product Domain', question: 'Which domain?'}],
      },
    };

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {
            action: 'submit',
            metadata: {
              form: {
                answers: {
                  domain: 'SaaS',
                },
              },
            },
          },
        },
      }),
      async () => new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_resume_1'}),
    );

    const parsed = parseAskUserResult(result?.content);
    expect(parsed).toEqual({
      action: 'submit',
      answers: {
        domain: 'SaaS',
      },
    });
  });

  it('should preserve multi-select answers in the AskUser result payload', async () => {
    const middleware = createInteractionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_resume_2',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: 'Need a short product brief.',
        questions: [{id: 'channels', label: 'Channels', question: 'Which channels?', input: 'multiselect'}],
      },
    };

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        hil: {
          resume: {
            action: 'submit',
            metadata: {
              form: {
                answers: {
                  channels: ['Docs', 'CLI'],
                },
              },
            },
          },
        },
      }),
      async () => new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_resume_2'}),
    );

    const parsed = parseAskUserResult(result?.content);
    expect(parsed).toEqual({
      action: 'submit',
      answers: {
        channels: ['Docs', 'CLI'],
      },
    });
  });
});

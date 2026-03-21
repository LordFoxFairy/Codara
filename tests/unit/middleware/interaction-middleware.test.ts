import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {z} from 'zod';
import {ASK_USER_TOOL_NAME, createAskUserQuestionMiddleware, parseAskUserResult, parseHILToolMessagePayload, type ToolCallContext} from '@core/middleware';

function createToolContext(
  toolCall: ToolCall,
  runtimeContext: Record<string, unknown> = {},
  messages: BaseMessage[] = [new HumanMessage('run')],
): ToolCallContext {
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

describe('createAskUserQuestionMiddleware', () => {
  it('should expose a JSON-schema-compatible AskUser tool schema', () => {
    const middleware = createAskUserQuestionMiddleware();
    const askUserTool = middleware.tools?.find((tool) => tool.name === ASK_USER_TOOL_NAME);

    expect(askUserTool).toBeDefined();
    expect(() => z.toJSONSchema(askUserTool!.schema)).not.toThrow();
  });

  it('should keep the AskUser tool-facing schema free of transform nodes', () => {
    const middleware = createAskUserQuestionMiddleware();
    const askUserTool = middleware.tools?.find((tool) => tool.name === ASK_USER_TOOL_NAME) as {
      schema?: {
        shape?: {
          summary?: {constructor?: {name?: string}};
          questions?: {
            element?: {
              shape?: {
                id?: {constructor?: {name?: string}};
                label?: {constructor?: {name?: string}};
              };
            };
          };
        };
      };
    } | undefined;

    expect(askUserTool?.schema?.shape?.summary?.constructor?.name).not.toBe('ZodPipe');
    expect(askUserTool?.schema?.shape?.questions?.element?.shape?.id?.constructor?.name).not.toBe('ZodPipe');
    expect(askUserTool?.schema?.shape?.questions?.element?.shape?.label?.constructor?.name).not.toBe('ZodPipe');
  });

  it('should pause AskUser tool calls with generic form UI metadata', async () => {
    const middleware = createAskUserQuestionMiddleware();
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
    expect(payload?.type === 'hil_pause' ? payload.request.ui?.form?.tabs[0]?.label : '').toBe('Product Doma');
    expect(payload?.type === 'hil_pause' ? payload.request.ui?.form?.tabs[0] : undefined).toMatchObject({input: 'select'});
  });

  it('should convert a resumed AskUser pause into a structured tool result', async () => {
    const middleware = createAskUserQuestionMiddleware();
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
    expect(result?.content).toContain('continue the original task immediately');
  });

  it('should preserve multi-select answers in the AskUser result payload', async () => {
    const middleware = createAskUserQuestionMiddleware();
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

  it('should clamp AskUser questionnaires to four short tab labels before rendering the review UI', async () => {
    const middleware = createAskUserQuestionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_pause_3',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: 'Need structured clarification.',
        questions: [
          {id: 'q1', label: '特别长的目标用户标签一', question: 'Q1?'},
          {id: 'q2', label: '特别长的目标用户标签二', question: 'Q2?'},
          {id: 'q3', label: '特别长的目标用户标签三', question: 'Q3?'},
          {id: 'q4', label: '特别长的目标用户标签四', question: 'Q4?'},
          {id: 'q5', label: '特别长的目标用户标签五', question: 'Q5?'},
        ],
      },
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_pause_3'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    const tabs = payload?.type === 'hil_pause' ? payload.request.ui?.form?.tabs ?? [] : [];

    expect(tabs).toHaveLength(4);
    expect(tabs.every((tab) => (tab.label?.length ?? 0) <= 12)).toBe(true);
  });

  it('should tolerate non-string summary values instead of crashing the middleware chain', async () => {
    const middleware = createAskUserQuestionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_pause_4',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: {
          text: 'Need one more clarification.',
        },
        questions: [
          {
            id: 'audience',
            label: 'Audience',
            question: 'Who is this for?',
            input: 'select',
            options: [{id: 'dev', label: 'Developers'}],
          },
        ],
      },
    };

    const result = await middleware.wrapToolCall?.(createToolContext(toolCall), async () => {
      return new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_pause_4'});
    });

    const payload = parseHILToolMessagePayload(result?.content);
    expect(payload?.type).toBe('hil_pause');
    expect(payload?.type === 'hil_pause' ? payload.request.description : '').toBe('Need one more clarification.');
    expect(payload?.type === 'hil_pause' ? payload.request.ui?.form?.summary : '').toBe('Need one more clarification.');
  });

  it('should block an immediate second AskUserQuestion after a submitted questionnaire and tell the model to continue', async () => {
    const middleware = createAskUserQuestionMiddleware();
    const toolCall: ToolCall = {
      id: 'call_interaction_pause_5',
      name: ASK_USER_TOOL_NAME,
      args: {
        summary: 'Need even more clarification.',
        questions: [
          {
            id: 'next',
            label: 'Next',
            question: 'What else?',
            input: 'select',
            options: [{id: 'one', label: 'One more thing'}],
          },
        ],
      },
    };

    const result = await middleware.wrapToolCall?.(
      createToolContext(toolCall, {
        codaraInteraction: {
          askUserContinuation: {
            action: 'submit',
            answers: {
              domain: 'SaaS',
            },
          },
        },
      }),
      async () => new ToolMessage({content: 'should-not-run', tool_call_id: 'call_interaction_pause_5'}),
    );

    expect(parseHILToolMessagePayload(result?.content)).toBeUndefined();
    expect(result?.content).toContain('AskUserQuestion was just answered in this flow');
    expect(result?.content).toContain('continue the original task immediately');
    expect(result?.content).toContain('Collected answers');
  });
});

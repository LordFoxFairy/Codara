import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createHILMiddleware} from '@core/middleware';

class ConfirmationModel {
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    const text = messages.map((m) => stringifyContent(m.content)).join('\n');

    if (text.includes('executed:git status')) {
      return new AIMessage('CONFIRMED_DONE');
    }

    const hasApprovalPrompt = text.includes('approved and continue');
    const hasPause = text.includes('"type":"hil_pause"');

    if (hasPause && !hasApprovalPrompt) {
      return new AIMessage('WAITING_USER_CONFIRMATION');
    }

    return new AIMessage({
      content: '',
      tool_calls: [{id: 'call_confirm', name: 'bash', args: {command: 'git status'}} as ToolCall],
    });
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}

describe('HIL user confirmation flow', () => {
  it('should pause first and continue after user confirmation resume', async () => {
    const model = new ConfirmationModel();

    let bashInvokeCount = 0;
    const bashTool = tool(
      async ({command}: {command: string}) => {
        bashInvokeCount += 1;
        return `executed:${command}`;
      },
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()}),
      }
    );

    const hilMiddleware = createHILMiddleware({
      interruptOn: {bash: true},
      handleResume: async (_request, resumePayload, context, handler) => {
        const payload = resumePayload as {action?: string};
        if (payload.action === 'allow') {
          return handler(context);
        }
        return new ToolMessage({
          content: 'Blocked by user decision',
          tool_call_id: context.toolCall.id ?? 'blocked',
          status: 'error',
        });
      },
    });

    const runner = createAgent({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middleware: [hilMiddleware],
    });

    const firstResult = await runner.invoke(
      {messages: [new HumanMessage('run git status')]},
      {recursionLimit: 4}
    );

    expect(firstResult.reason).toBe('complete');
    expect(model.invocations).toHaveLength(1);
    expect(String(firstResult.state.messages[firstResult.state.messages.length - 1]?.content)).toContain(
      '"type":"hil_pause"'
    );
    expect(bashInvokeCount).toBe(0);

    const secondResult = await runner.resume(
      {action: 'allow'},
      {
        input: new HumanMessage('approved and continue'),
        recursionLimit: 4,
      }
    );

    expect(secondResult.reason).toBe('complete');
    expect(String(secondResult.state.messages[secondResult.state.messages.length - 1]?.content)).toContain(
      'CONFIRMED_DONE'
    );
    expect(bashInvokeCount).toBe(1);
  });
});

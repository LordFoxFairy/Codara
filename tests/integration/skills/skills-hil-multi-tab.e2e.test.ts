import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {createHILMiddleware, type HILPauseRequest} from '@core/middleware';

class MultiToolPauseModel {
  private step = 0;
  readonly invocations: BaseMessage[][] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages);

    if (this.step === 0) {
      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_write', name: 'write_file', args: {path: 'a.txt', content: 'hello'}} as ToolCall,
          {id: 'call_email', name: 'send_email', args: {to: 'a@b.com', subject: 'Hi'}} as ToolCall,
        ],
      });
    }

    return new AIMessage('TWO_TABS_PAUSED');
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

describe('HIL multi-tab pause metadata', () => {
  it('should emit two pause requests with different ui tab metadata', async () => {
    const model = new MultiToolPauseModel();

    let writeInvokeCount = 0;
    let emailInvokeCount = 0;

    const writeTool = tool(
      async () => {
        writeInvokeCount += 1;
        return 'written';
      },
      {
        name: 'write_file',
        description: 'Write content',
        schema: z.object({path: z.string(), content: z.string()}),
      }
    );

    const emailTool = tool(
      async () => {
        emailInvokeCount += 1;
        return 'sent';
      },
      {
        name: 'send_email',
        description: 'Send email',
        schema: z.object({to: z.string(), subject: z.string()}),
      }
    );

    const pauseRequests: HILPauseRequest[] = [];
    const hilMiddleware = createHILMiddleware({
      interruptOn: {
        write_file: {
          channel: 'approval-center',
          ui: {tab: 'FileOps'},
        },
        send_email: {
          channel: 'approval-center',
          ui: {tab: 'CommsOps'},
        },
      },
      onPause: (request) => {
        pauseRequests.push(request);
      },
    });

    const runner = createAgentRunner({
      model: model as unknown as BaseChatModel,
      tools: [writeTool, emailTool],
      middlewares: [hilMiddleware],
    });

    const result = await runner.invoke(
      {messages: [new HumanMessage('Do both write and email operations.')]},
      {recursionLimit: 4}
    );

    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toContain('TWO_TABS_PAUSED');

    expect(writeInvokeCount).toBe(0);
    expect(emailInvokeCount).toBe(0);

    expect(pauseRequests).toHaveLength(2);

    const byTool = new Map(pauseRequests.map((request) => [request.action.toolName, request]));

    expect(byTool.get('write_file')?.channel).toBe('approval-center');
    expect((byTool.get('write_file')?.ui as Record<string, unknown>)?.tab).toBe('FileOps');

    expect(byTool.get('send_email')?.channel).toBe('approval-center');
    expect((byTool.get('send_email')?.ui as Record<string, unknown>)?.tab).toBe('CommsOps');
  });
});

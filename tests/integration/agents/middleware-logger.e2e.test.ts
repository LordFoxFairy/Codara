import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createMiddleware} from '@core/middleware';

class ScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  bindTools(): this {
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const response = this.responses[this.index];
    if (!response) {
      throw new Error(`No scripted response at index ${this.index}`);
    }
    this.index += 1;
    return response;
  }
}

describe('Agent Middleware Logger End-to-End', () => {
  it('应在真实链路中记录 middleware 各阶段日志', async () => {
    const echoTool = tool(async ({text}: {text: string}) => `ECHO:${text}`, {
      name: 'echo_text',
      description: 'Echo text back',
      schema: z.object({
        text: z.string(),
      }),
    });

    const logs: string[] = [];
    const loggingMiddleware = createMiddleware({
      name: 'LoggingMiddleware',
      beforeAgent: (state) => {
        logs.push(`beforeAgent:${state.turn}`);
      },
      beforeModel: (state) => {
        logs.push(`beforeModel:${state.turn}:${state.messages.length}`);
      },
      wrapModelCall: async (request, handler) => {
        logs.push(`wrapModelCall:start:${request.turn}`);
        const response = await handler(request);
        logs.push(`wrapModelCall:end:${request.turn}`);
        return response;
      },
      afterModel: (state) => {
        const lastMessage = state.messages[state.messages.length - 1];
        logs.push(`afterModel:${state.turn}:${String(lastMessage?.content ?? '')}`);
      },
      wrapToolCall: async (request, handler) => {
        logs.push(`wrapToolCall:${request.turn}:${request.toolCall.name}`);
        return handler(request);
      },
      afterAgent: (state) => {
        logs.push(`afterAgent:${state.turn}:${state.result.reason}`);
      }
    });
    const retryMiddleware = createMiddleware({
      name: 'RetryMiddleware',
      wrapModelCall: async (request, handler) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            return await handler(request);
          } catch (error) {
            if (attempt === 1) {
              throw error;
            }
            console.log(`Retry ${attempt + 1}/2 after error: ${String(error)}`);
          }
        }
        throw new Error('Unreachable');
      }
    });

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'echo_call',
            name: 'echo_text',
            args: {text: 'ping'},
            type: 'tool_call',
          },
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const runner = createAgent({
      model,
      tools: [echoTool],
      middleware: [retryMiddleware, loggingMiddleware]
    });

    const result = await runner.invoke(
      {
        messages: [
          new HumanMessage(
            '你必须只调用一次 echo_text 工具，参数 text=ping。拿到工具结果后立即给出最终答复，不要再次调用工具。'
          )
        ]
      },
      {recursionLimit: 8}
    );

    expect(result.reason).toBe('complete');

    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as
      | ToolMessage
      | undefined;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage?.content ?? '')).toContain('ECHO:ping');

    expect(logs.some((line) => line.startsWith('beforeAgent:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('beforeModel:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('wrapModelCall:start:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('wrapModelCall:end:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('afterModel:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('wrapToolCall:'))).toBe(true);
    expect(logs.some((line) => line.startsWith('afterAgent:'))).toBe(true);
  });
});

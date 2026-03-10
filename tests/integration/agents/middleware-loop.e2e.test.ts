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

describe('Agent Middleware End-to-End', () => {
  it('应在真实 agent 循环中触发 middleware hooks 并包裹工具调用', async () => {
    const echoTool = tool(async ({text}: {text: string}) => `ECHO:${text}`, {
      name: 'echo_text',
      description: 'Echo text back',
      schema: z.object({
        text: z.string(),
      }),
    });

    const events: string[] = [];
    const traceMiddleware = createMiddleware({
      name: 'TraceMiddleware',
      beforeAgent: (state) => {
        events.push(`beforeAgent:${state.turn}`);
      },
      wrapModelCall: async (request, handler) => {
        events.push(`wrapModelCall:start:${request.turn}`);
        const message = await handler(request);
        events.push(`wrapModelCall:end:${request.turn}`);
        return message;
      },
      wrapToolCall: async (request, handler) => {
        events.push(`wrapToolCall:${request.turn}:${request.toolCall.name}`);
        return handler(request);
      },
      afterAgent: (state) => {
        events.push(`afterAgent:${state.turn}:${state.result.reason}`);
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
      middleware: [traceMiddleware]
    });

    const result = await runner.invoke(
      {
        messages: [
          new HumanMessage(
            '你必须只调用一次 echo_text 工具，参数 text=ping。拿到工具结果后立即给出最终答复，不要再次调用工具。'
          ),
        ],
      },
      {recursionLimit: 8}
    );

    expect(result.reason).toBe('complete');
    expect(result.turns).toBeGreaterThan(0);

    const hookBeforeCount = events.filter((event) => event.startsWith('beforeAgent:')).length;
    const hookAfterCount = events.filter((event) => event.startsWith('afterAgent:')).length;
    expect(hookBeforeCount).toBe(result.turns);
    expect(hookAfterCount).toBe(result.turns);

    const hasModelWrap = events.some((event) => event.startsWith('wrapModelCall:start:'));
    expect(hasModelWrap).toBe(true);

    const hasToolHook = events.some((event) => event.startsWith('wrapToolCall:'));
    expect(hasToolHook).toBe(true);

    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage.content)).toContain('ECHO:ping');
  });
});

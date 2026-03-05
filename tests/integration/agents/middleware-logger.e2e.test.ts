import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {createMiddleware} from '@core/middleware';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

describe('Agent Middleware Logger End-to-End', () => {
  it('应在真实链路中记录 middleware 各阶段日志', async () => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(deepseekKey && !deepseekKey.startsWith('your-'))).toBe(true);

    const config = await loadModelRoutingConfig();
    const registry = new ModelRegistry(config);
    const factory = new ChatModelFactory(registry);
    const model = await factory.create('deepseek');

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
        logs.push(`About to call model with ${state.messages.length} messages`);
      },
      wrapModelCall: async (request, handler) => {
        logs.push(`wrapModelCall:start:${request.turn}`);
        const response = await handler(request);
        logs.push(`wrapModelCall:end:${request.turn}`);
        return response;
      },
      afterModel: (state) => {
        const lastMessage = state.messages[state.messages.length - 1];
        logs.push(`Model returned: ${String(lastMessage?.content ?? '')}`);
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
    const runner = createAgentRunner({
      model,
      tools: [echoTool],
      middlewares: [retryMiddleware, loggingMiddleware]
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
  }, 120_000);
});

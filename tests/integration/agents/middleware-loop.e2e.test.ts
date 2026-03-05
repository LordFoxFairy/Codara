import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {createMiddleware} from '@core/middleware';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

describe('Agent Middleware End-to-End', () => {
  it('应在真实 agent 循环中触发 middleware hooks 并包裹工具调用', async () => {
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

    const runner = createAgentRunner({
      model,
      tools: [echoTool],
      middlewares: [traceMiddleware]
    });

    const result = await runner.invoke(
      {
        messages: [
          new HumanMessage(
            '你必须只调用一次 echo_text 工具，参数 text 必须是 ping。调用完成后直接给出最终答案，不要继续调用工具。'
          ),
        ],
      },
      {recursionLimit: 6}
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
  }, 120_000);
});

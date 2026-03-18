import {afterEach, describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {ChatModelFactory, ModelRegistry, parseModelRoutingConfig} from '@integration/provider';
import {createMockRoutingConfig, startMockOpenAIServer} from '../provider/mock-openai-server';

describe('Agent Loop End-to-End', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('应通过 provider stack + createAgent 完成一轮真实工具调用', async () => {
    const server = startMockOpenAIServer([
      {
        toolCalls: [
          {
            id: 'echo_call',
            name: 'echo_text',
            arguments: {text: 'ping'},
          },
        ],
      },
      {content: 'done'},
    ]);
    cleanups.push(() => server.stop());

    const config = parseModelRoutingConfig(createMockRoutingConfig(server.baseUrl));
    const registry = new ModelRegistry(config);
    const factory = new ChatModelFactory(registry);
    const model = await factory.create('mock');

    const echoTool = tool(async ({text}: {text: string}) => `ECHO:${text}`, {
      name: 'echo_text',
      description: 'Echo text back',
      schema: z.object({
        text: z.string(),
      }),
    });

    const runner = createAgent({
      model,
      tools: [echoTool]
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

    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage.content)).toContain('ECHO:ping');
    expect(server.requests).toHaveLength(2);
  });
});

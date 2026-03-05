import {describe, expect, it} from 'bun:test';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentRunner} from '@core/agents';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';

describe('Agent Loop End-to-End', () => {
  it('应通过 bindTools + AgentRunner 完成一轮真实工具调用', async () => {
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

    const runner = createAgentRunner({
      model,
      tools: [echoTool]
    });

    const result = await runner.invoke(
      {
        messages: [
          new HumanMessage(
            '你必须只调用一次 echo_text 工具，参数 text 必须是 ping。调用后直接结束。'
          ),
        ],
      },
      {recursionLimit: 6}
    );

    expect(result.reason).toBe('complete');

    const toolMessage = result.state.messages.find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage.content)).toContain('ECHO:ping');
  }, 120_000);
});

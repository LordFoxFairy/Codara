/**
 * 基础集成测试：Model + Agent + Tools
 *
 * 测试三大核心模块的基本集成
 */

import {describe, expect, it} from 'bun:test';
import {HumanMessage} from '@langchain/core/messages';
import {ChatModelFactory, loadModelRoutingConfig, ModelRegistry} from '@core/provider';
import {createAgentRunner} from '@core/agents';
import {createBuiltinTools} from '@core/tools';

describe('Basic Integration: Model + Agent + Tools', () => {
  it('应该能够使用内置工具完成文件操作任务', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    expect(Boolean(apiKey && !apiKey.startsWith('your-'))).toBe(true);

    const config = await loadModelRoutingConfig();
    const registry = new ModelRegistry(config);
    const factory = new ChatModelFactory(registry);
    const model = await factory.create('deepseek');

    const tools = createBuiltinTools({
      cwd: process.cwd(),
    });

    expect(tools.length).toBe(8);
    expect(tools.map((t) => t.name)).toEqual([
      'bash',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'fetch_url',
      'web_search',
    ]);

    const agent = createAgentRunner({
      model,
      tools
    });

    const result = await agent.invoke(
      {
        messages: [new HumanMessage('请使用 glob 工具查找 src/core/tools 目录下的所有 .ts 文件')],
      },
      {
        recursionLimit: 10,
      }
    );

    expect(result.reason).toBe('complete');
    expect(result.turns).toBeGreaterThan(0);
    expect(result.turns).toBeLessThanOrEqual(10);

    const hasToolCall = result.state.messages.some((m) => m._getType() === 'tool');
    expect(hasToolCall).toBe(true);
  }, 60_000);
});

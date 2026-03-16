/**
 * 基础集成测试：Model + Agent + Tools
 *
 * 测试三大核心模块的基本集成
 */

import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@engine/agent';
import {createBuiltinTools} from '@capability/tool';

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

describe('Basic Integration: Model + Agent + Tools', () => {
  it('应该能够使用内置工具完成文件操作任务', async () => {
    const tools = createBuiltinTools({
      cwd: process.cwd(),
    });

    expect(tools.length).toBe(11);
    expect(tools.map((t) => t.name)).toEqual([
      'bash',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'fetch_url',
      'web_search',
      'get_diagnostics',
      'notebook_read',
      'multi_edit',
    ]);

    const globTool = tools.find((tool) => tool.name === 'glob');
    expect(globTool).toBeDefined();

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_glob_1',
            name: 'glob',
            args: {
              pattern: '**/*.ts',
              path: 'src/capability/tool',
            },
            type: 'tool_call',
          },
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: globTool ? [globTool] : [],
    });

    const result = await agent.invoke(
      {
        messages: [new HumanMessage('请使用 glob 工具查找 src/capability/tool 目录下的所有 .ts 文件')],
      },
      {
        recursionLimit: 10,
      }
    );

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(2);

    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as ToolMessage | undefined;
    expect(toolMessage).toBeDefined();
    expect(String(toolMessage?.content ?? '')).toContain('/src/capability/tool/');
  });
});

import {describe, expect, it} from 'bun:test';
import {AIMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {TASK_TOOL_NAME, createTaskTool} from '@core/tasking/task';
import {createBuiltinAgentStore, createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool filtering', () => {
  it('应对 builtin Explore profile 应用工具过滤', async () => {
    const childModel = new ChildSummaryModel();
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_explore',
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Explore the repo',
              subagent_type: 'Explore',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinAgentStore())],
      tools: [
        createTaskTool({
          model: childModel as unknown as BaseChatModel,
          tools: [
            tool(async () => 'ok', {name: 'read_file', description: 'read', schema: z.object({})}),
            tool(async () => 'ok', {name: 'grep', description: 'grep', schema: z.object({})}),
            tool(async () => 'ok', {name: 'fetch_url', description: 'fetch', schema: z.object({})}),
            tool(async () => 'ok', {name: 'web_search', description: 'search', schema: z.object({})}),
            tool(async () => 'ok', {name: 'write_file', description: 'write', schema: z.object({})}),
          ],
        }),
      ],
    });

    const result = await parent.invoke('delegate this');

    expect(result.reason).toBe('complete');
    expect(childModel.boundToolNames).toEqual(['read_file', 'grep', 'fetch_url', 'web_search']);
  });
});

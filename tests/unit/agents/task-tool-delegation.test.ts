import {describe, expect, it} from 'bun:test';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent, createTaskTool, TASK_TOOL_NAME} from '@core/agents';
import {createBuiltinAgentStore, createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool delegation', () => {
  it('应通过正式 Task 工具委派子代理并回传摘要', async () => {
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_delegate',
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Investigate the auth flow',
              subagent_type: 'general-purpose',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinAgentStore())],
      tools: [
        createTaskTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('Subagent completed.');
    expect(String(toolMessage.content)).toContain('summary:\ntask_child_humans:1');
  });
});

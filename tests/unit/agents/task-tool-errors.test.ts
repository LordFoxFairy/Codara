import {describe, expect, it} from 'bun:test';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agents';
import {TASK_TOOL_NAME, createTaskTool} from '@core/tasks/task';
import {ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool errors', () => {
  it('应在收到未知 subagent_type 时明确报错', async () => {
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_bad_type',
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Plan the architecture',
              subagent_type: 'UnknownType',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createTaskTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.status).toBe('error');
    expect(String(toolMessage.content)).toContain('Unknown subagent_type "UnknownType"');
  });
});

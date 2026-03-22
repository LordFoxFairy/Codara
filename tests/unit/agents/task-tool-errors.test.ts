import {describe, expect, it} from 'bun:test';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agent';
import {AGENT_TOOL_NAME, createAgentTool} from '@capability/subagent/middleware';
import {ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createAgentTool errors', () => {
  it('应在缺少 subagent_type 时明确报错，基础 child 必须显式使用 Agent', async () => {
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_missing_type',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Plan the architecture',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createAgentTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.status).toBe('error');
    expect(String(toolMessage.content)).toContain('Invalid input: expected string, received undefined');
    expect(String(toolMessage.content)).toContain('subagent_type');
  });

  it('应拒绝旧的 general-purpose subagent_type', async () => {
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_old_default_type',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Plan the architecture',
              subagent_type: 'general-purpose',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createAgentTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(toolMessage.status).toBe('error');
    expect(String(toolMessage.content)).toContain('Unknown subagent_type "general-purpose"');
  });

  it('应在收到未知 subagent_type 时明确报错', async () => {
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_bad_type',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Plan the architecture',
              subagent_type: 'UnknownType',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createAgentTool({
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

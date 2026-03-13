import {describe, expect, it} from 'bun:test';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createHILMiddleware} from '@core/middleware';
import {TASK_TOOL_NAME, createTaskTool} from '@core/tasks/task';
import {readDelegatedAgentResult} from '@core/tasks/delegation';
import {createBuiltinSubagentStore, createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

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
      middleware: [createAgentSkillsMiddleware(createBuiltinSubagentStore())],
      tools: [
        createTaskTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('Delegated task completed.');
    expect(String(toolMessage.content)).toContain('summary:\ntask_child_humans:1');
    expect(readDelegatedAgentResult(toolMessage.artifact)).toEqual({
      type: 'delegated_agent_result',
      sessionId: expect.any(String),
      turns: 1,
      reason: 'complete',
      summary: 'task_child_humans:1',
    });
  });

  it('应将 Task child 的 HIL pause 提升到 parent，并在 resume 后继续 child checkpoint', async () => {
    let dangerousInvokeCount = 0;
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_pause',
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Investigate the guarded flow',
              subagent_type: 'general-purpose',
            },
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinSubagentStore())],
      tools: [
        createTaskTool({
          model: new ScriptedModel([
            new AIMessage({
              content: '',
              tool_calls: [{
                id: 'child_guarded_call',
                name: 'dangerous_tool',
                args: {path: 'task-guarded.txt'},
              } as ToolCall],
            }),
            new AIMessage('task_child_done'),
          ]) as unknown as BaseChatModel,
          tools: [
            tool(async () => {
              dangerousInvokeCount += 1;
              return 'dangerous:done';
            }, {
              name: 'dangerous_tool',
              description: 'Dangerous tool',
              schema: z.object({
                path: z.string(),
              }),
            }),
          ],
          middleware: [
            createHILMiddleware({
              interruptOn: {
                dangerous_tool: true,
              },
            }),
          ],
        }),
      ],
    });

    const paused = await parent.invoke('delegate this');

    expect(paused.reason).toBe('complete');
    expect(paused.state.status).toBe('paused');
    expect(paused.state.pendingPause?.metadata).toMatchObject({
      codara: {
        delegatedSubagent: {
          childSessionId: expect.any(String),
          parentToolName: TASK_TOOL_NAME,
        },
      },
    });

    const resumed = await parent.resume({decision: 'approve'});
    const toolMessages = resumed.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
    const toolMessage = toolMessages[toolMessages.length - 1] as ToolMessage;

    expect(resumed.reason).toBe('complete');
    expect(resumed.state.status).toBe('idle');
    expect(resumed.state.pendingPause).toBeUndefined();
    expect(dangerousInvokeCount).toBe(1);
    expect(String(toolMessage.content)).toContain('Delegated task completed.');
    expect(String(toolMessage.content)).toContain('summary:\ntask_child_done');
  });
});

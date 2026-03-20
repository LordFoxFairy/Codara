import {describe, expect, it} from 'bun:test';
import {AIMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createHILMiddleware} from '@core/middleware';
import {createTaskRunMemoryStore} from '@capability/task';
import {TASK_TOOL_NAME, createTaskTool} from '@capability/task/middleware';
import {readTaskRunLaunchResult} from '@shared/task-run-launch';
import {createBuiltinSubagentStore, createAgentSkillsMiddleware, ChildSummaryModel, ScriptedModel} from './task-tool.fixtures';

describe('createTaskTool delegation', () => {
  it('should stop the parent turn immediately after task launch instead of consuming a second assistant reply', async () => {
    const runStore = createTaskRunMemoryStore();

    class CountingParentModel {
      invokeCount = 0;

      async invoke(): Promise<AIMessage> {
        this.invokeCount += 1;
        if (this.invokeCount === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call_task_detached',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Inspect the project layout',
                subagent_type: 'general-purpose',
              },
            } as ToolCall],
          });
        }

        return new AIMessage('this should never be consumed');
      }

      bindTools(): this {
        return this;
      }
    }

    const parentModel = new CountingParentModel();
    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinSubagentStore())],
      tools: [
        createTaskTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
          runStore,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(parentModel.invokeCount).toBe(1);
    expect(readTaskRunLaunchResult(toolMessage.artifact)).toMatchObject({
      type: 'task_run_started',
      runId: 'call_task_detached',
    });
  });

  it('应通过正式 Task 工具启动后台子代理并立即返回 run handle', async () => {
    const runStore = createTaskRunMemoryStore();
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
          runStore,
        }),
      ],
    });

    const result = await parent.invoke('delegate this');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingPause).toBeUndefined();
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(launch).toEqual({
      type: 'task_run_started',
      runId: 'call_task_delegate',
      sessionId: expect.any(String),
      agentName: 'general-purpose',
      label: 'Delegating general-purpose: Investigate the auth flow',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runStore.get('call_task_delegate')).toEqual(expect.objectContaining({
      runId: 'call_task_delegate',
      childSessionId: launch?.sessionId,
      status: 'completed',
      summary: 'task_child_humans:1',
    }));
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
          runStore: createTaskRunMemoryStore(),
        }),
      ],
    });

    const paused = await parent.invoke('delegate this');

    expect(paused.reason).toBe('complete');
    expect(paused.state.status).toBe('idle');
    expect(paused.state.pendingPause).toBeUndefined();
    expect(dangerousInvokeCount).toBe(0);
  });

  it('应在同一个 parent session 重复使用相同 Task tool_call id 时创建新的 detached run', async () => {
    const runStore = createTaskRunMemoryStore();

    class RepeatingParentModel {
      async invoke(): Promise<AIMessage> {
        return new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_repeat',
            name: TASK_TOOL_NAME,
            args: {
              prompt: 'Repeat the detached task',
              subagent_type: 'general-purpose',
            },
          } as ToolCall],
        });
      }

      bindTools(): this {
        return this;
      }
    }

    class CountingChildModel {
      private callCount = 0;

      async invoke(): Promise<AIMessage> {
        this.callCount += 1;
        return new AIMessage(`child_done_${this.callCount}`);
      }

      bindTools(): this {
        return this;
      }
    }

    const parent = createAgent({
      model: new RepeatingParentModel() as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinSubagentStore())],
      tools: [
        createTaskTool({
          model: new CountingChildModel() as unknown as BaseChatModel,
          runStore,
        }),
      ],
    });

    await parent.invoke('first detached run');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await parent.invoke('second detached run');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runStore.list()).toEqual([
      expect.objectContaining({
        runId: 'call_task_repeat',
        status: 'completed',
        summary: 'child_done_1',
      }),
      expect.objectContaining({
        runId: 'call_task_repeat__2',
        status: 'completed',
        summary: 'child_done_2',
      }),
    ]);
  });

  it('should launch every Task tool call in the same parent response before detaching the turn', async () => {
    const runStore = createTaskRunMemoryStore();

    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_task_parallel_1',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Analyze the tech stack',
                subagent_type: 'Explore',
              },
            } as ToolCall,
            {
              id: 'call_task_parallel_2',
              name: TASK_TOOL_NAME,
              args: {
                prompt: 'Analyze the project structure',
                subagent_type: 'Explore',
              },
            } as ToolCall,
          ],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(createBuiltinSubagentStore())],
      tools: [
        createTaskTool({
          model: new ChildSummaryModel() as unknown as BaseChatModel,
          runStore,
        }),
      ],
    });

    const result = await parent.invoke('delegate both');
    expect(result.reason).toBe('complete');

    await new Promise((resolve) => setTimeout(resolve, 30));

    const runs = runStore.list();
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 'call_task_parallel_1',
        status: 'completed',
      }),
      expect.objectContaining({
        runId: 'call_task_parallel_2',
        status: 'completed',
      }),
    ]));
  });
});

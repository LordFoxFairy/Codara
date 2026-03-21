import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createHILMiddleware, createMiddleware} from '@core/middleware';
import {createAgentFileCheckpointer, createAgentMemoryCheckpointer} from '@durability/checkpoint';
import {createTaskRunMemoryStore, createTaskRuntime, type TaskRunRecord} from '@capability/task';
import {TASK_TOOL_NAME, createTaskTool} from '@capability/task/middleware';
import {readTaskRunLaunchResult} from '@shared/task-run-launch';

class ScriptedModel {
  private index = 0;
  boundToolNames: string[] = [];

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No fake response at index ${this.index}`);
    }

    this.index += 1;
    return current;
  }

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolNames = tools.map((candidate) => candidate.name);
    return this;
  }
}

class HumanCountModel {
  boundToolNames: string[] = [];

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`child_humans:${humanCount}`);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolNames = tools.map((candidate) => candidate.name);
    return this;
  }
}

class ChildProbeModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message) => message.type === 'system')
      .map((message) => String(message.content))
      .join('\n---\n');
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`${systemText}\nchild_humans:${humanCount}`.trim());
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

async function waitForTaskRunStatus(
  runStore: {get(runId: string): TaskRunRecord | undefined},
  runId: string,
  status: TaskRunRecord['status'],
): Promise<TaskRunRecord> {
  const deadline = Date.now() + 500;

  while (Date.now() < deadline) {
    const record = runStore.get(runId);
    if (record?.status === status) {
      return record;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Task run "${runId}" did not reach status "${status}"`);
}

describe('Task delegation', () => {
  it('应通过 Agent 基础 child 启动隔离子代理并在后台 run store 中收敛摘要', async () => {
    const runStore = createTaskRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_1',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect the task in a fresh context', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new HumanCountModel();
    const taskTool = createTaskTool({
      model: childModel as unknown as BaseChatModel,
      runStore,
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const completed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'completed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingPause).toBeUndefined();
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(launch).toMatchObject({
      type: 'task_run_started',
      runId: 'call_task_1',
      parentSessionId: result.state.sessionId,
      agentName: 'Agent',
      label: 'Delegating Agent: Inspect the task in a fresh context',
      sessionId: expect.any(String),
    });
    expect(completed).toMatchObject({
      runId: 'call_task_1',
      parentSessionId: result.state.sessionId,
      status: 'completed',
      summary: 'child_humans:1',
      reason: 'complete',
    });
  });

  it('应在 child tools 中移除所有 delegation tools', async () => {
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_2',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Run a child task', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new ScriptedModel([new AIMessage('child_done')]);
    const echoTool = tool(async () => 'pong', {
      name: 'echo',
      description: 'Echo tool',
      schema: z.object({}),
    });
    const nestedTaskTool = createTaskTool({
      model: new ScriptedModel([new AIMessage('nested_done')]) as unknown as BaseChatModel,
      tools: [echoTool],
    });
    const taskTool = createTaskTool({
      model: childModel as unknown as BaseChatModel,
      tools: [echoTool, nestedTaskTool],
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke('start');

    expect(result.reason).toBe('complete');
    expect(childModel.boundToolNames).toEqual(['echo']);
    expect(childModel.boundToolNames).not.toContain(TASK_TOOL_NAME);
  });

  it('应将 child 失败收敛成可解释的后台 Task 结果，而不是让父代理崩溃', async () => {
    const runStore = createTaskRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_3',
          name: TASK_TOOL_NAME,
          args: {prompt: 'This child will fail', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const failingChildModel = {
      async invoke(): Promise<AIMessage> {
        throw new Error('child boom');
      },
      bindTools(): unknown {
        return this;
      },
    } as unknown as BaseChatModel;
    const taskTool = createTaskTool({
      model: failingChildModel,
      runStore,
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const failed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'failed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingPause).toBeUndefined();
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(launch).toMatchObject({
      type: 'task_run_started',
      runId: 'call_task_3',
      sessionId: expect.any(String),
    });
    expect(failed).toMatchObject({
      runId: 'call_task_3',
      status: 'failed',
      errorMessage: 'child boom',
      reason: 'error',
    });
  });

  it('应为 delegated child 持久化 subagent checkpoint 身份', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const runStore = createTaskRunMemoryStore();
    const parent = createAgent({
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_checkpoint',
            name: TASK_TOOL_NAME,
            args: {prompt: 'Persist the child checkpoint', subagent_type: 'Agent'},
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createTaskTool({
          model: new ScriptedModel([new AIMessage('child_done')]) as unknown as BaseChatModel,
          checkpointer,
          runStore,
        }),
      ],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const completed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'completed') : undefined;
    const checkpoint = launch ? await checkpointer.getLatest(launch.sessionId) : undefined;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(launch?.sessionId).toBeDefined();
    expect(completed?.status).toBe('completed');
    expect(checkpoint?.state.agentType).toBe('subagent');
  });

  it('should complete delegated child runs with a file checkpointer even when the parent session id contains Windows-invalid path characters', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-task-file-checkpointer-'));
    const checkpointer = createAgentFileCheckpointer({rootDir});
    const runStore = createTaskRunMemoryStore();
    const parent = createAgent({
      sessionId: 'parent:session/run\\child?*',
      model: new ScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_task_windows_safe',
            name: TASK_TOOL_NAME,
          args: {prompt: 'Persist the child checkpoint with a file checkpointer', subagent_type: 'Agent'},
          } as ToolCall],
        }),
        new AIMessage('done'),
      ]) as unknown as BaseChatModel,
      tools: [
        createTaskTool({
          model: new ScriptedModel([new AIMessage('child_done')]) as unknown as BaseChatModel,
          checkpointer,
          runStore,
        }),
      ],
    });

    const result = await parent.invoke('start');
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const completed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'completed') : undefined;
    const checkpoint = launch ? await checkpointer.getLatest(launch.sessionId) : undefined;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(completed?.status).toBe('completed');
    expect(checkpoint?.state.agentType).toBe('subagent');
  });

  it('应默认隔离父代理的 messages、context、values 和 runtime.shared', async () => {
    const runStore = createTaskRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_isolation',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect isolation', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);

    const childProbe = createMiddleware({
      name: 'child-probe',
      beforeModel(context) {
        context.systemMessage.push(JSON.stringify({
          durableContext: context.state.context,
          runtimeContext: context.runtime.runtimeContext,
          runtimeShared: context.runtime.shared,
          values: context.state.values,
        }));
        return undefined;
      },
    });

    const taskTool = createTaskTool({
      model: new ChildProbeModel() as unknown as BaseChatModel,
      middleware: [childProbe],
      runStore,
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
      context: {parentContext: true},
      values: {parentValue: true},
      middleware: [
        createMiddleware({
          name: 'parent-runtime-shared',
          beforeModel: () => ({
            runtimeShared: {
              parentShared: true,
            },
          }),
        }),
      ],
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const completed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'completed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingPause).toBeUndefined();
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(launch?.sessionId).toBeDefined();
    expect(completed?.summary).toContain('"durableContext":{}');
    expect(completed?.summary).toContain('"runtimeContext":{}');
    expect(completed?.summary).toContain('"runtimeShared":{}');
    expect(completed?.summary).toContain('"values":{}');
    expect(completed?.summary).toContain('child_humans:1');
    expect(completed?.summary).not.toContain('parent_request');
  });

  it('应只继承显式为 delegated child 提供的 context 和 values seed', async () => {
    const runStore = createTaskRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_seeded',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect seeds', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);

    const childProbe = createMiddleware({
      name: 'child-seed-probe',
      beforeModel(context) {
        context.systemMessage.push(JSON.stringify({
          durableContext: context.state.context,
          values: context.state.values,
        }));
        return undefined;
      },
    });

    const taskTool = createTaskTool({
      model: new ChildProbeModel() as unknown as BaseChatModel,
      middleware: [childProbe],
      context: {seededContext: 'child-only'},
      values: {seededValue: 1},
      runStore,
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
      context: {parentContext: true},
      values: {parentValue: true},
    });

    const result = await parent.invoke({messages: [new HumanMessage('parent_request')]});
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(toolMessage.artifact);
    const completed = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'completed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingPause).toBeUndefined();
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(completed?.summary).toContain('"durableContext":{"seededContext":"child-only"}');
    expect(completed?.summary).toContain('"values":{"seededValue":1}');
    expect(completed?.summary).not.toContain('parentContext');
    expect(completed?.summary).not.toContain('parentValue');
  });

  it('应将 child HIL pause 提升到 parent，并在 resume 后继续 child checkpoint', async () => {
    const runStore = createTaskRunMemoryStore();
    const taskRuntime = createTaskRuntime({runStore});
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_pause',
          name: TASK_TOOL_NAME,
          args: {prompt: 'Run guarded child task', subagent_type: 'Agent'},
          } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]);
    const childModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'child_guarded_call',
          name: 'dangerous_tool',
          args: {path: 'guarded.txt'},
        } as ToolCall],
      }),
      new AIMessage('child_done'),
    ]);

    let dangerousInvokeCount = 0;
    const dangerousTool = tool(async () => {
      dangerousInvokeCount += 1;
      return 'dangerous:done';
    }, {
      name: 'dangerous_tool',
      description: 'Dangerous tool',
      schema: z.object({path: z.string()}),
    });

    const taskTool = createTaskTool({
      model: childModel as unknown as BaseChatModel,
      tools: [dangerousTool],
      middleware: [
        createHILMiddleware({
          interruptOn: {dangerous_tool: true},
        }),
      ],
      runStore,
      runtime: taskRuntime,
    });

    const parent = createAgent({
      model: parentModel as unknown as BaseChatModel,
      tools: [taskTool],
    });

    const firstResult = await parent.invoke('start');
    const firstToolMessage = firstResult.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;
    const launch = readTaskRunLaunchResult(firstToolMessage.artifact);
    const paused = launch ? await waitForTaskRunStatus(runStore, launch.runId, 'paused') : undefined;

    expect(firstResult.reason).toBe('complete');
    expect(firstResult.state.status).toBe('idle');
    expect(firstResult.state.pendingPause).toBeUndefined();
    expect(String(firstToolMessage.content)).toContain('Delegated task started in background.');
    expect(launch).toBeDefined();
    expect(paused).toMatchObject({
      status: 'paused',
      childSessionId: expect.any(String),
    });
    expect(dangerousInvokeCount).toBe(0);

    await taskRuntime.resumeRun(launch!.runId, {decision: 'approve'});
    const completed = await waitForTaskRunStatus(runStore, launch!.runId, 'completed');

    expect(completed.status).toBe('completed');
    expect(completed.summary).toContain('child_done');
    expect(dangerousInvokeCount).toBe(1);
  });
});

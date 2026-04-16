import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {
  createAgent,
} from '@core/agent';
import {
  createTaskCreateTool,
  createTaskListTool,
  createTaskMemoryStore,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
} from '@capability/task';
import {createSkillsMiddleware} from '@core/middleware';
import {FileSystemSkillStore, readSkillsRuntimeData} from '@capability/skill';
import {createSkillTool} from '@capability/skill/runtime/commands';
import {loadSkillsRuntimeBundle} from '@context/skills-bundle';
import {createSubagentRunMemoryStore} from '@capability/subagent';
import {AGENT_TOOL_NAME, createSubagentTool} from '@capability/subagent/tool';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';

function createBuiltinSubagentStore() {
  return new FileSystemSkillStore({
    sources: [path.join(process.cwd(), '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

class ScriptedModel {
  private index = 0;

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
    void tools;
    return this;
  }
}

class SharedTaskReaderModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const taskListMessage = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'call_task_list'
    )) as ToolMessage | undefined;

    if (!taskListMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_list',
          name: TASK_LIST_TOOL_NAME,
          args: {},
        } as ToolCall],
      });
    }

    const sawTask = String(taskListMessage.content).includes('subject:');
    return new AIMessage(`shared_tasks_visible:${sawTask}`);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

async function waitForSubagentRunStatus(
  runStore: {get(runId: string): {status: string; summary?: string} | undefined},
  runId: string,
  status: string,
): Promise<{status: string; summary?: string}> {
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

describe('task delegation + task store', () => {
  it('主代理创建的 shared task 应能被 Agent 基础 child 读取到', async () => {
    const store = createTaskMemoryStore();
    const runStore = createSubagentRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_create',
          name: TASK_CREATE_TOOL_NAME,
          args: {
            subject: 'Implement auth',
            description: 'Build the authentication flow',
          },
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_delegate_default',
          name: AGENT_TOOL_NAME,
          args: {prompt: 'Inspect shared tasks', subagent_type: 'Agent'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]) as unknown as BaseChatModel;
    const taskCreateTool = createTaskCreateTool({store});
    const taskListTool = createTaskListTool({store});
    const taskTool = createSubagentTool({
      model: new SharedTaskReaderModel() as unknown as BaseChatModel,
      tools: [taskListTool],
      runStore,
    });

    const parent = createAgent({
      model: parentModel,
      tools: [taskCreateTool, taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('Coordinate auth work')]});
    const delegatedMessage = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message as ToolMessage)
      .find((message) => String(message.content).includes('Subagent started in background.')) as ToolMessage | undefined;
    const launch = delegatedMessage ? readSubagentRunLaunchResult(delegatedMessage.artifact) : undefined;
    const completed = launch ? await waitForSubagentRunStatus(runStore, launch.runId, 'completed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingReview).toBeUndefined();
    expect(delegatedMessage).toBeDefined();
    expect(String(delegatedMessage?.content)).toContain('Subagent started in background.');
    expect(launch).toMatchObject({
      type: 'subagent_run_started',
      runId: 'call_task_delegate_default',
      sessionId: expect.any(String),
    });
    expect(completed?.summary).toContain('shared_tasks_visible:true');
  });

  it('正式 Task 工具应能与 TaskCreate/TaskList 并存，并读取共享 task store', async () => {
    const store = createTaskMemoryStore();
    const runStore = createSubagentRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_create_via_task_tool',
          name: TASK_CREATE_TOOL_NAME,
          args: {
            subject: 'Implement billing',
            description: 'Build the billing workflow',
          },
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_delegate_formal',
          name: AGENT_TOOL_NAME,
          args: {
            prompt: 'Inspect shared tasks',
            subagent_type: 'Agent',
          },
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]) as unknown as BaseChatModel;
    const taskCreateTool = createTaskCreateTool({store});
    const taskListTool = createTaskListTool({store});
    const taskTool = createSubagentTool({
      model: new SharedTaskReaderModel() as unknown as BaseChatModel,
      tools: [taskListTool],
      runStore,
    });

    const parent = createAgent({
      model: parentModel,
      middleware: [createSkillsMiddleware({store: createBuiltinSubagentStore(), loadBundle: loadSkillsRuntimeBundle, readSkillsRuntimeData, createSkillTool})],
      tools: [taskCreateTool, taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('Coordinate billing work')]});
    const taskMessage = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message as ToolMessage)
      .find((message) => String(message.content).includes('Subagent started in background.')) as ToolMessage | undefined;
    const launch = taskMessage ? readSubagentRunLaunchResult(taskMessage.artifact) : undefined;
    const completed = launch ? await waitForSubagentRunStatus(runStore, launch.runId, 'completed') : undefined;

    expect(result.reason).toBe('complete');
    expect(result.state.status).toBe('idle');
    expect(result.state.pendingReview).toBeUndefined();
    expect(taskMessage).toBeDefined();
    expect(String(taskMessage?.content)).toContain('Subagent started in background.');
    expect(launch).toMatchObject({
      type: 'subagent_run_started',
      runId: 'call_task_delegate_formal',
      agentName: 'Agent',
      sessionId: expect.any(String),
    });
    expect(completed?.summary).toContain('shared_tasks_visible:true');
  });

  it('应在同一个 parent response 中同时执行 shared task coordination 和多个 delegated Task', async () => {
    const store = createTaskMemoryStore();
    const runStore = createSubagentRunMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_task_create_mixed',
            name: TASK_CREATE_TOOL_NAME,
            args: {
              subject: 'Coordinate release work',
              description: 'Track planning and implementation delegates',
            },
          } as ToolCall,
          {
            id: 'call_task_delegate_mixed_1',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Inspect shared tasks',
              subagent_type: 'Agent',
            },
          } as ToolCall,
          {
            id: 'call_task_delegate_mixed_2',
            name: AGENT_TOOL_NAME,
            args: {
              prompt: 'Inspect shared tasks again',
              subagent_type: 'Agent',
            },
          } as ToolCall,
        ],
      }),
      new AIMessage('this response should not be consumed after delegation'),
    ]) as unknown as BaseChatModel;

    const taskCreateTool = createTaskCreateTool({store});
    const taskListTool = createTaskListTool({store});
    const taskTool = createSubagentTool({
      model: new SharedTaskReaderModel() as unknown as BaseChatModel,
      tools: [taskListTool],
      runStore,
    });

    const parent = createAgent({
      model: parentModel,
      middleware: [createSkillsMiddleware({store: createBuiltinSubagentStore(), loadBundle: loadSkillsRuntimeBundle, readSkillsRuntimeData, createSkillTool})],
      tools: [taskCreateTool, taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('Coordinate release work')]});
    const records = await store.list();
    const firstRun = await waitForSubagentRunStatus(runStore, 'call_task_delegate_mixed_1', 'completed');
    const secondRun = await waitForSubagentRunStatus(runStore, 'call_task_delegate_mixed_2', 'completed');

    expect(result.reason).toBe('complete');
    expect(records).toEqual([
      expect.objectContaining({
        subject: 'Coordinate release work',
        description: 'Track planning and implementation delegates',
      }),
    ]);
    expect(firstRun.summary).toContain('shared_tasks_visible:true');
    expect(secondRun.summary).toContain('shared_tasks_visible:true');
  });
});

import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {
  createAgent,
} from '@core/agents';
import {
  createTaskCreateTool,
  createTaskListTool,
  createTaskMemoryStore,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@core/tasking';
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills';
import {createTaskTool} from '@core/tasking/task';

function createBuiltinAgentStore() {
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

describe('task delegation + task store', () => {
  it('主代理创建的 shared task 应能被默认 delegated child 读取到', async () => {
    const store = createTaskMemoryStore();
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
          name: TASK_TOOL_NAME,
          args: {prompt: 'Inspect shared tasks'},
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]) as unknown as BaseChatModel;
    const taskCreateTool = createTaskCreateTool({store});
    const taskListTool = createTaskListTool({store});
    const taskTool = createTaskTool({
      model: new SharedTaskReaderModel() as unknown as BaseChatModel,
      tools: [taskListTool],
    });

    const parent = createAgent({
      model: parentModel,
      tools: [taskCreateTool, taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('Coordinate auth work')]});
    const delegatedMessage = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message as ToolMessage)
      .find((message) => String(message.content).includes('Delegated task completed.')) as ToolMessage | undefined;

    expect(result.reason).toBe('complete');
    expect(delegatedMessage).toBeDefined();
    expect(String(delegatedMessage?.content)).toContain('shared_tasks_visible:true');
  });

  it('正式 Task 工具应能与 TaskCreate/TaskList 并存，并读取共享 task store', async () => {
    const store = createTaskMemoryStore();
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
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'Inspect shared tasks',
            subagent_type: 'general-purpose',
          },
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]) as unknown as BaseChatModel;
    const taskCreateTool = createTaskCreateTool({store});
    const taskListTool = createTaskListTool({store});
    const taskTool = createTaskTool({
      model: new SharedTaskReaderModel() as unknown as BaseChatModel,
      tools: [taskListTool],
    });

    const parent = createAgent({
      model: parentModel,
      middleware: [createSkillsMiddleware({store: createBuiltinAgentStore()})],
      tools: [taskCreateTool, taskTool],
    });

    const result = await parent.invoke({messages: [new HumanMessage('Coordinate billing work')]});
    const taskMessage = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message as ToolMessage)
      .find((message) => String(message.content).includes('Delegated task completed.')) as ToolMessage | undefined;

    expect(result.reason).toBe('complete');
    expect(taskMessage).toBeDefined();
    expect(String(taskMessage?.content)).toContain('shared_tasks_visible:true');
  });
});

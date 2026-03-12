import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createSkillsMiddleware} from '@core/middleware';
import {FileSystemSkillStore} from '@core/skills';
import {
  createSharedTaskMiddleware,
  createTaskListTool,
  createTaskMemoryStore,
  createTaskMiddleware,
  createTaskUpdateTool,
  type TaskRecord,
} from '@core/tasks';

class ParentScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const current = this.responses[this.index];
    if (!current) {
      throw new Error(`No parent response at index ${this.index}`);
    }

    this.index += 1;
    return current;
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

class CoordinatedSubagentModel {
  readonly boundToolSnapshots: string[][] = [];

  bindTools(tools: StructuredToolInterface[]): this {
    this.boundToolSnapshots.push(tools.map((toolItem) => toolItem.name));
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const systemText = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');

    if (systemText.includes('You are a Plan subagent.')) {
      return this.runPlan(messages);
    }

    if (systemText.includes('You are an Explore subagent.')) {
      return this.runExplore(messages);
    }

    if (systemText.includes('You are a general-purpose subagent.')) {
      return this.runGeneral(messages);
    }

    throw new Error(`Unknown delegated profile. System prompt was:\n${systemText}`);
  }

  private runPlan(messages: BaseMessage[]): AIMessage {
    const readMessage = findToolMessage(messages, 'call_plan_read');
    if (!readMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_plan_read', name: 'read_file', args: {path: '/virtual/plan.md'}} as ToolCall],
      });
    }

    return new AIMessage(`PLAN_DONE:${String(readMessage.content).includes('plan-doc')}`);
  }

  private runExplore(messages: BaseMessage[]): AIMessage {
    const grepMessage = findToolMessage(messages, 'call_explore_grep');
    if (!grepMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_explore_grep', name: 'grep', args: {pattern: 'TODO', path: '/virtual/src'}} as ToolCall],
      });
    }

    return new AIMessage(`EXPLORE_DONE:${String(grepMessage.content).includes('grep-match:TODO')}`);
  }

  private runGeneral(messages: BaseMessage[]): AIMessage {
    const taskListMessage = findToolMessage(messages, 'call_general_task_list');
    if (!taskListMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_general_task_list', name: 'TaskList', args: {}} as ToolCall],
      });
    }

    const taskUpdateMessage = findToolMessage(messages, 'call_general_task_update');
    if (!taskUpdateMessage) {
      const taskId = readFirstTaskId(String(taskListMessage.content));
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_general_task_update',
          name: 'TaskUpdate',
          args: {taskId, status: 'in_progress', owner: 'general-purpose'},
        } as ToolCall],
      });
    }

    return new AIMessage(`GENERAL_DONE:${String(taskUpdateMessage.content).includes('status: in_progress')}`);
  }
}

function createProjectSkillStore(): FileSystemSkillStore {
  return new FileSystemSkillStore({
    sources: [path.join(process.cwd(), '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

function findToolMessage(messages: BaseMessage[], toolCallId: string): ToolMessage | undefined {
  return messages.find((message) => (
    ToolMessage.isInstance(message) && message.tool_call_id === toolCallId
  )) as ToolMessage | undefined;
}

function readFirstTaskId(content: string): string {
  const match = content.match(/- id: ([^ |\n]+)/);
  if (!match?.[1]) {
    throw new Error(`Unable to read task id from TaskList content:\n${content}`);
  }
  return match[1];
}

describe('subagent multi-profile cases', () => {
  it('should verify Plan, Explore, and general-purpose delegates cooperate over one parent flow', async () => {
    const store = createTaskMemoryStore();
    const childModel = new CoordinatedSubagentModel();
    const agent = createAgent({
      model: new ParentScriptedModel([
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_parent_task_create',
            name: 'TaskCreate',
            args: {
              subject: 'Coordinate multi-subagent run',
              description: 'Track plan, exploration, and implementation follow-up',
            },
          } as ToolCall],
        }),
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_parent_plan',
            name: 'Task',
            args: {
              prompt: 'Create the implementation plan',
              subagent_type: 'Plan',
            },
          } as ToolCall],
        }),
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_parent_explore',
            name: 'Task',
            args: {
              prompt: 'Explore the current codebase state',
              subagent_type: 'Explore',
            },
          } as ToolCall],
        }),
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'call_parent_general',
            name: 'Task',
            args: {
              prompt: 'Inspect the shared tasks and mark the active item in progress',
              subagent_type: 'general-purpose',
            },
          } as ToolCall],
        }),
        new AIMessage('PARENT_DONE'),
      ]) as unknown as BaseChatModel,
      middleware: [
        createSkillsMiddleware({store: createProjectSkillStore()}),
        createSharedTaskMiddleware({store}),
        createTaskMiddleware({
          model: childModel as unknown as BaseChatModel,
          tools: [
            tool(async ({path: targetPath}: {path: string}) => `plan-doc:${targetPath}`, {
              name: 'read_file',
              description: 'Read file content',
              schema: z.object({path: z.string()}),
            }),
            tool(async ({pattern, path: targetPath}: {pattern: string; path: string}) => `grep-match:${pattern}@${targetPath}`, {
              name: 'grep',
              description: 'Search file content',
              schema: z.object({pattern: z.string(), path: z.string()}),
            }),
            tool(async ({url}: {url: string}) => `fetch:${url}`, {
              name: 'fetch_url',
              description: 'Fetch url',
              schema: z.object({url: z.string()}),
            }),
            tool(async ({query}: {query: string}) => `search:${query}`, {
              name: 'web_search',
              description: 'Search web',
              schema: z.object({query: z.string()}),
            }),
            createTaskListTool({store}),
            createTaskUpdateTool({store}),
          ],
        }),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('Coordinate multiple delegates')]}, {recursionLimit: 10});
    const delegatedMessages = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => String(message.content))
      .filter((content) => content.includes('Delegated task completed.'));
    const tasks = await store.list();

    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toContain('PARENT_DONE');

    expect(delegatedMessages.some((content) => content.includes('PLAN_DONE:true'))).toBe(true);
    expect(delegatedMessages.some((content) => content.includes('EXPLORE_DONE:true'))).toBe(true);
    expect(delegatedMessages.some((content) => content.includes('GENERAL_DONE:true'))).toBe(true);

    expect(childModel.boundToolSnapshots).toHaveLength(3);
    expect(childModel.boundToolSnapshots[0]).toEqual(['read_file', 'grep', 'fetch_url', 'web_search']);
    expect(childModel.boundToolSnapshots[1]).toEqual(['read_file', 'grep', 'fetch_url', 'web_search']);
    expect(childModel.boundToolSnapshots[2]).toEqual([
      'read_file',
      'grep',
      'fetch_url',
      'web_search',
      'TaskList',
      'TaskUpdate',
    ]);

    expect(tasks).toHaveLength(1);
    expectTask(tasks[0], {
      subject: 'Coordinate multi-subagent run',
      status: 'in_progress',
      owner: 'general-purpose',
    });
  });
});

function expectTask(task: TaskRecord | undefined, input: Pick<TaskRecord, 'subject' | 'status' | 'owner'>): void {
  expect(task).toBeDefined();
  expect(task?.subject).toBe(input.subject);
  expect(task?.status).toBe(input.status);
  expect(task?.owner).toBe(input.owner);
}

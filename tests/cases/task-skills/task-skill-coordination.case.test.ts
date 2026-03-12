import {describe, expect, it} from 'bun:test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AIMessage, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents';
import {createSkillsMiddleware} from '@core/middleware';
import {FileSystemSkillStore} from '@core/skills';
import {
  createTaskCreateTool,
  createTaskListTool,
  createTaskMemoryStore,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@core/tasks';
import {createTaskTool} from '@core/tasks/task';

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

class SkillAwareScriptedModel {
  private step = 0;

  constructor(
    private readonly skillName: string,
    private readonly skillPath: string,
    private readonly referencePath: string,
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const joined = messages.map((message) => stringifyMessage(message.content)).join('\n');

    if (this.step === 0) {
      if (!joined.includes(this.skillName) || !joined.includes(this.skillPath)) {
        return new AIMessage('SKILL_NOT_VISIBLE');
      }

      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_skill', name: 'read_file', args: {path: this.skillPath}} as ToolCall],
      });
    }

    if (this.step === 1) {
      this.step += 1;
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_reference', name: 'read_file', args: {path: this.referencePath}} as ToolCall],
      });
    }

    return new AIMessage('TASK_DONE');
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
        tool_calls: [{id: 'call_task_list', name: TASK_LIST_TOOL_NAME, args: {}} as ToolCall],
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

function createProjectSkillStore(): FileSystemSkillStore {
  return new FileSystemSkillStore({
    sources: [path.join(process.cwd(), '.codara', 'skills')],
    cacheTtlMs: 0,
  });
}

function stringifyMessage(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(content);
}

describe('task-skills cases', () => {
  it('should expose project skill context during a task-oriented skill workflow', async () => {
    const projectSkillsRoot = path.join(process.cwd(), '.codara', 'skills');
    const skillPath = path.join(projectSkillsRoot, 'basic-task-flow', 'SKILL.md');
    const referencePath = path.join(projectSkillsRoot, 'basic-task-flow', 'references', 'checklist.md');
    const skillStore = new FileSystemSkillStore({sources: [projectSkillsRoot], cacheTtlMs: 0});

    const model = new SkillAwareScriptedModel('basic-task-flow', skillPath, referencePath);
    const readFileTool = tool(
      async ({path: targetPath}: {path: string}) => readFile(targetPath, 'utf8'),
      {
        name: 'read_file',
        description: 'Read file content',
        schema: z.object({path: z.string()}),
      },
    );

    const agent = createAgent({
      model: model as unknown as BaseChatModel,
      tools: [readFileTool],
      middleware: [createSkillsMiddleware({store: skillStore})],
    });

    const result = await agent.invoke({
      messages: [new HumanMessage('Please complete the task using project skill workflow.')],
    }, {recursionLimit: 6});

    expect(result.reason).toBe('complete');
    expect(result.turns).toBe(3);
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toContain('TASK_DONE');
  });

  it('should let a skill-selected Task delegate read shared tasks created by the parent agent', async () => {
    const store = createTaskMemoryStore();
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_create',
          name: TASK_CREATE_TOOL_NAME,
          args: {
            subject: 'Inspect task-skill integration',
            description: 'Verify delegated child can read shared tasks',
          },
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_delegate',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'Inspect shared tasks',
            subagent_type: 'general-purpose',
          },
        } as ToolCall],
      }),
      new AIMessage('parent_done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model: parentModel,
      middleware: [createSkillsMiddleware({store: createProjectSkillStore()})],
      tools: [
        createTaskCreateTool({store}),
        createTaskTool({
          model: new SharedTaskReaderModel() as unknown as BaseChatModel,
          tools: [createTaskListTool({store})],
        }),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('Coordinate task and skill flow')]});
    const delegatedSummary = result.state.messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => String(message.content))
      .find((content) => content.includes('Delegated task completed.'));

    expect(result.reason).toBe('complete');
    expect(delegatedSummary).toBeDefined();
    expect(delegatedSummary).toContain('shared_tasks_visible:true');
  });
});

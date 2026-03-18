import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@engine/agent';
import {createCodaraGuidelinesSource} from '@infra/context/instructions/guidelines';
import {createCodaraPromptSource} from '@infra/context/prompts/prompt-source';
import {buildBaseSystemMessage} from '@infra/context/session-bundle/base-system-message';
import {
  createTaskMemoryStore,
  createTaskMiddleware,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@capability/task';
import {
  readDelegatedAgentResult,
} from '@capability/task/delegation';
import {createAgentSkillsMiddleware, createBuiltinSubagentStore} from '../agents/task-tool.fixtures';

class ScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const response = this.responses[this.index];
    if (!response) {
      throw new Error(`No scripted response at index ${this.index}`);
    }
    this.index += 1;
    return response;
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

class ChildSummaryModel {
  async invoke(): Promise<AIMessage> {
    return new AIMessage('child middleware summary');
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

class SystemEchoModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const content = messages
      .filter((message) => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n---\n');
    return new AIMessage(content);
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

class ChildProgressiveDisclosureModel {
  constructor(private readonly targetFile: string) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const toolMessage = messages.find((message) => (
      ToolMessage.isInstance(message) && message.tool_call_id === 'call_child_progressive_read'
    )) as ToolMessage | undefined;

    if (!toolMessage) {
      return new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_child_progressive_read',
          name: 'read_file',
          args: {path: this.targetFile},
        } as ToolCall],
      });
    }

    const systemText = messages
      .filter((message): message is SystemMessage => SystemMessage.isInstance(message))
      .map((message) => String(message.content))
      .join('\n');

    return new AIMessage(
      `child_visible:${systemText.includes('APP_RULE') || systemText.includes('APP_HANDBOOK')}`,
    );
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools;
    return this;
  }
}

describe('tasks middlewares', () => {
  it('should register the delegated Task tool through middleware', async () => {
    const store = createBuiltinSubagentStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_middleware',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'delegate this',
          },
        } as ToolCall],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      middleware: [createAgentSkillsMiddleware(store), taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')]);
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(taskMiddleware.tools?.map((tool) => tool.name)).toEqual([TASK_TOOL_NAME]);
    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('child middleware summary');
    expect(readDelegatedAgentResult(toolMessage.artifact)?.summary).toBe('child middleware summary');
  });

  it('should inject available subagent definitions from skills runtime before model calls', async () => {
    const store = createBuiltinSubagentStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });

    const agent = createAgent({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      middleware: [createAgentSkillsMiddleware(store), taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('show tasks prompt')]);
    const lastAi = result.state.messages[result.state.messages.length - 1] as AIMessage;

    expect(String(lastAi.content)).toContain('Available Subagents');
    expect(String(lastAi.content)).toContain('general-purpose');
    expect(String(lastAi.content)).toContain('Explore');
  });

  it('should delegate through Task middleware without requiring skills runtime for the default delegate', async () => {
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_default_delegate',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'delegate with the default child',
          },
        } as ToolCall],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      middleware: [taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')]);
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(taskMiddleware.tools?.map((tool) => tool.name)).toEqual([TASK_TOOL_NAME]);
    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('child middleware summary');
    expect(readDelegatedAgentResult(toolMessage.artifact)?.summary).toBe('child middleware summary');
  });

  it('should keep delegated children on the startup instruction chain even after read_file tool usage', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-task-progressive-'));
    const projectRoot = path.join(root, 'project');
    const targetFile = path.join(projectRoot, 'packages', 'app', 'src', 'feature.ts');
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, 'packages', 'app', '.codara'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'ROOT_RULE', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'app', 'AGENTS.md'), 'APP_RULE', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), 'ROOT_HANDBOOK', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'app', '.codara', 'codara.md'), 'APP_HANDBOOK', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');

    const guidelinesSource = createCodaraGuidelinesSource({projectRoot, cwd: projectRoot});
    const promptSource = createCodaraPromptSource({projectRoot, cwd: projectRoot});

    const taskMiddleware = createTaskMiddleware({
      model: new ChildProgressiveDisclosureModel(targetFile) as unknown as BaseChatModel,
      tools: [
        tool(async ({path: filePath}: {path: string}) => readFile(filePath, 'utf8'), {
          name: 'read_file',
          description: 'Read a file for delegated progressive disclosure tests.',
          schema: z.object({path: z.string()}),
        }),
      ],
      prepareContext: async (context) => {
        const next = await buildBaseSystemMessage(promptSource, guidelinesSource);
        context.systemMessage = [...next.systemMessage];
        context.runtime.shared = next.runtimeShared ? {...next.runtimeShared} : {};
        context.messages = context.state.messages;
      },
    });
    const parentModel = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_progressive_delegate',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'inspect the deeper feature file',
          },
        } as ToolCall],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model: parentModel,
      middleware: [taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')]);
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('child_visible:false');
  });

  it('should expose shared task coordination tools through the single Task middleware', async () => {
    const store = createTaskMemoryStore();
    const taskMiddleware = createTaskMiddleware({
      store,
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_create',
          name: TASK_CREATE_TOOL_NAME,
          args: {
            subject: 'Write tests',
            description: 'Cover the new middleware path',
          },
        } as ToolCall],
      }),
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_list',
          name: TASK_LIST_TOOL_NAME,
          args: {},
        } as ToolCall],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      middleware: [taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')], {recursionLimit: 3});
    const taskToolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(taskMiddleware.tools?.map((tool) => tool.name)).toEqual([
      TASK_TOOL_NAME,
      TASK_CREATE_TOOL_NAME,
      'TaskUpdate',
      TASK_LIST_TOOL_NAME,
    ]);
    expect(result.reason).toBe('complete');
    expect(String(taskToolMessages[0]?.content)).toContain('Task created.');
    expect(String(taskToolMessages[1]?.content)).toContain('Write tests');
  });
});

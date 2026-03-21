import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agent';
import {createCodaraGuidelinesSource} from '@context/instructions/guidelines';
import {createCodaraPromptSource} from '@context/prompts/prompt-source';
import {buildBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {
  createTaskMemoryStore,
  createTaskRunMemoryStore,
  createTaskMiddleware,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@capability/task';
import {formatTaskRunLaunchResult, readTaskRunLaunchResult} from '@shared/task-run-launch';
import {createAgentSkillsMiddleware, createBuiltinSubagentStore} from '../agents/task-tool.fixtures';

async function waitForCondition(
  predicate: () => boolean,
  options: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition was not satisfied before timeout');
}

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
  it('should keep task launch text terse and directive for parent agents', () => {
    const launchText = formatTaskRunLaunchResult({
      type: 'task_run_started',
      runId: 'run-1',
      parentSessionId: 'session-1',
      sessionId: 'session-1:task:run-1',
      agentName: 'Explore',
      label: 'Delegating Explore: Inspect the project',
    });

    expect(launchText).toContain('Delegated task started in background.');
    expect(launchText).toContain('Do not restate launch metadata');
    expect(launchText).not.toContain('run_id:');
    expect(launchText).not.toContain('delegate_id:');
    expect(launchText).not.toContain('agent:');
  });

  it('should register the delegated Task tool through middleware', async () => {
    const store = createBuiltinSubagentStore();
    const runStore = createTaskRunMemoryStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
      runStore,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_middleware',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'delegate this',
            subagent_type: 'Agent',
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
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(String(toolMessage.content)).not.toContain('run_id:');
    expect(readTaskRunLaunchResult(toolMessage.artifact)).toEqual(expect.objectContaining({
      type: 'task_run_started',
      runId: 'call_task_middleware',
    }));

    await waitForCondition(() => runStore.get('call_task_middleware')?.status === 'completed');
    expect(runStore.get('call_task_middleware')).toEqual(expect.objectContaining({
      runId: 'call_task_middleware',
      status: 'completed',
      summary: 'child middleware summary',
    }));
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
    expect(String(lastAi.content)).toContain('Agent: built-in child that inherits the main-agent baseline');
    expect(String(lastAi.content)).toContain('Explore');
  });

  it('should inject delegated task completion results into main-agent continuation turns', async () => {
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });
    const context = {
      state: {
        agentType: 'main' as const,
        messages: [],
        context: {},
        values: {},
      },
      messages: [] as BaseMessage[],
      runtime: {
        context: {},
        runtimeContext: {
          codaraTaskCompletion: {
            tasks: [
              {
                runId: 'run-tech',
                label: 'Delegating Explore: Analyze the tech stack',
                agentName: 'Explore',
                status: 'completed',
                summary: 'Child summary should stay hidden from the transcript.',
                toolUseCount: 4,
                totalTokens: 1200,
              },
              {
                runId: 'run-structure',
                label: 'Delegating Explore: Analyze the project structure',
                agentName: 'Explore',
                status: 'completed',
                summary: 'Another child summary.',
                toolUseCount: 5,
                totalTokens: 1800,
              },
            ],
          },
        },
        shared: {},
      },
      systemMessage: [] as string[],
      execution: {
        sessionId: 'session-1',
        runId: 'run-main',
        turn: 1,
        maxTurns: 8,
        requestId: 'req-main',
      },
    };

    await taskMiddleware.beforeModel?.(context);

    expect(context.systemMessage.join('\n')).toContain('Delegated tasks from your previous response have completed');
    expect(context.systemMessage.join('\n')).toContain('Respond now with a unified user-facing answer');
    expect(context.systemMessage.join('\n')).toContain('Do not restate task-by-task reports or raw child sections');
    expect(context.systemMessage.join('\n')).toContain('Do not mention subagents, delegated tasks, hidden handoff context, or orchestration stages');
    expect(context.systemMessage.join('\n')).toContain('Never write headings such as "Subagent report", "Phase 1", "First subagent"');
    expect(context.systemMessage.join('\n')).toContain('Analyze the tech stack');
    expect(context.systemMessage.join('\n')).toContain('4 tool uses');
    expect(context.systemMessage.join('\n')).toContain('1.2k tokens');
    expect(context.systemMessage.join('\n')).toContain('- topic: Analyze the tech stack | status: completed');
    expect(context.systemMessage.join('\n')).not.toContain('Delegating Explore: Analyze the tech stack');
    expect(context.systemMessage.join('\n')).not.toContain('Child summary should stay hidden from the transcript.');
  });

  it('should delegate through Task middleware without requiring skills runtime for the built-in Agent child', async () => {
    const runStore = createTaskRunMemoryStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
      runStore,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_default_delegate',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'delegate with the Agent child',
            subagent_type: 'Agent',
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
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    expect(String(toolMessage.content)).not.toContain('run_id:');
    await waitForCondition(() => runStore.get('call_task_default_delegate')?.status === 'completed');
    expect(runStore.get('call_task_default_delegate')).toEqual(expect.objectContaining({
      runId: 'call_task_default_delegate',
      status: 'completed',
      summary: 'child middleware summary',
    }));
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
    const runStore = createTaskRunMemoryStore();

    const taskMiddleware = createTaskMiddleware({
      model: new ChildProgressiveDisclosureModel(targetFile) as unknown as BaseChatModel,
      runStore,
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
            subagent_type: 'Agent',
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
    expect(String(toolMessage.content)).toContain('Delegated task started in background.');
    await waitForCondition(() => runStore.get('call_task_progressive_delegate')?.status === 'completed');
    expect(runStore.get('call_task_progressive_delegate')).toEqual(expect.objectContaining({
      runId: 'call_task_progressive_delegate',
      status: 'completed',
      summary: 'child_visible:false',
    }));
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

  it('should write delegated task runs into the stable run store', async () => {
    const store = createBuiltinSubagentStore();
    const runStore = createTaskRunMemoryStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
      runStore,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_task_run_store',
          name: TASK_TOOL_NAME,
          args: {
            prompt: 'inspect the login flow',
            subagent_type: 'Explore',
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

    expect(result.reason).toBe('complete');
    await waitForCondition(() => runStore.get('call_task_run_store')?.status === 'completed');
    expect(runStore.list()).toEqual([
      expect.objectContaining({
        runId: 'call_task_run_store',
        sessionId: expect.any(String),
        label: 'Delegating Explore: inspect the login flow',
        agentName: 'Explore',
        status: 'completed',
        summary: 'child middleware summary',
        childSessionId: expect.any(String),
      }),
    ]);
  });
});

import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents';
import {
  createSharedTaskMiddleware,
  createTaskMemoryStore,
  createTaskMiddleware,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@core/tasks';
import {
  readDelegatedAgentResult,
} from '@core/tasks/delegation';
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

    expect(String(lastAi.content)).toContain('Task Delegation');
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

  it('should expose shared task coordination tools as a dedicated middleware', async () => {
    const store = createTaskMemoryStore();
    const sharedTaskMiddleware = createSharedTaskMiddleware({store});
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
      middleware: [sharedTaskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')], {recursionLimit: 3});
    const taskToolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(sharedTaskMiddleware.tools?.map((tool) => tool.name)).toEqual([
      TASK_CREATE_TOOL_NAME,
      'TaskUpdate',
      TASK_LIST_TOOL_NAME,
    ]);
    expect(result.reason).toBe('complete');
    expect(String(taskToolMessages[0]?.content)).toContain('Task created.');
    expect(String(taskToolMessages[1]?.content)).toContain('Write tests');
  });
});

import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents';
import {
  createSharedTaskMiddleware,
  createSubagentMiddleware,
  createTaskMiddleware,
  DEFAULT_SUBAGENT_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_TOOL_NAME,
} from '@core/middleware';
import {createTaskMemoryStore} from '@core/tasking';
import {createAgentSkillsMiddleware, createBuiltinAgentStore} from '../agents/task-tool.fixtures';

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

describe('tasking middlewares', () => {
  it('should register the delegated Task tool through middleware', async () => {
    const store = createBuiltinAgentStore();
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
      middlewares: [createAgentSkillsMiddleware(store), taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')]);
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(taskMiddleware.tools?.map((tool) => tool.name)).toEqual([TASK_TOOL_NAME]);
    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('child middleware summary');
  });

  it('should inject available subagent definitions from skills runtime before model calls', async () => {
    const store = createBuiltinAgentStore();
    const taskMiddleware = createTaskMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });

    const agent = createAgent({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      middlewares: [createAgentSkillsMiddleware(store), taskMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('show tasking prompt')]);
    const lastAi = result.state.messages[result.state.messages.length - 1] as AIMessage;

    expect(String(lastAi.content)).toContain('Task Delegation');
    expect(String(lastAi.content)).toContain('Available Subagents');
    expect(String(lastAi.content)).toContain('general-purpose');
    expect(String(lastAi.content)).toContain('Explore');
  });

  it('should register the primitive subagent tool through middleware', async () => {
    const subagentMiddleware = createSubagentMiddleware({
      model: new ChildSummaryModel() as unknown as BaseChatModel,
    });
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'call_subagent_middleware',
          name: DEFAULT_SUBAGENT_TOOL_NAME,
          args: {
            prompt: 'subdelegate this',
          },
        } as ToolCall],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      middlewares: [subagentMiddleware],
    });

    const result = await agent.invoke([new HumanMessage('start')]);
    const toolMessage = result.state.messages.find((message) => ToolMessage.isInstance(message)) as ToolMessage;

    expect(subagentMiddleware.tools?.map((tool) => tool.name)).toEqual([DEFAULT_SUBAGENT_TOOL_NAME]);
    expect(result.reason).toBe('complete');
    expect(String(toolMessage.content)).toContain('child middleware summary');
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
      middlewares: [sharedTaskMiddleware],
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

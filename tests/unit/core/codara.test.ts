import {describe, expect, it} from 'bun:test';
import {AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createMiddleware} from '@core/middleware';
import {
  createAgentMemoryCheckpointer,
  createCodara,
  createCodaraAgent,
  createCodaraMiddlewares,
  createCodaraTools,
  loadCodaraAgent,
  type AgentStreamMessagesChunk,
} from '@core';
import type {SkillMetadata, SkillStore} from '@core/skills/types';

class EmptySkillStore implements SkillStore {
  async discover(): Promise<SkillMetadata[]> {
    return [];
  }
}

class EchoModel {
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    const humanCount = messages.filter((message) => HumanMessage.isInstance(message)).length;
    return new AIMessage(`seen_humans:${humanCount}`);
  }

  bindTools(): this {
    return this;
  }
}

class StreamingEchoModel extends EchoModel {
  async stream(messages: BaseMessage[]): Promise<AsyncGenerator<AIMessageChunk>> {
    const response = await this.invoke(messages);
    const text = String(response.content);

    return (async function* () {
      yield new AIMessageChunk(text);
    })();
  }
}

class FakeModel {
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

  bindTools(): this {
    return this;
  }
}

describe('Codara core facade', () => {
  it('should include builtin tools by default', () => {
    const tools = createCodaraTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'bash',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'fetch_url',
      'web_search',
    ]);
  });

  it('should let caller tools override builtin tools with the same name', () => {
    const overrideRead = {
      name: 'read',
      description: 'Custom read',
      schema: {} as never,
      invoke: async () => 'override',
    } as unknown as StructuredToolInterface;

    const tools = createCodaraTools({
      tools: [overrideRead],
    });

    expect(tools.some((tool) => tool === overrideRead)).toBe(true);
    expect(tools.filter((tool) => tool.name === 'read')).toHaveLength(1);
  });

  it('should include SkillsMiddleware by default', () => {
    const middlewares = createCodaraMiddlewares({
      skills: {store: new EmptySkillStore()},
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'SkillsMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should place logging first, caller middlewares before HIL, and keep HIL last', () => {
    const custom = createMiddleware({
      name: 'CustomMiddleware',
      beforeModel: () => undefined,
    });

    const middlewares = createCodaraMiddlewares({
      logging: {enabled: true},
      skills: {store: new EmptySkillStore()},
      middlewares: [custom],
    });

    expect(middlewares.map((middleware) => middleware.name)).toEqual([
      'LoggingMiddleware',
      'SkillsMiddleware',
      'CustomMiddleware',
      'HumanInTheLoopMiddleware',
    ]);
  });

  it('should let caller tool middleware short-circuit before default HIL', async () => {
    const toolCall: ToolCall = {id: 'call_1', name: 'echo', args: {text: 'ping'}};
    const model = new FakeModel([
      new AIMessage({content: '', tool_calls: [toolCall]}),
      new AIMessage('done'),
    ]);
    const tool = {
      name: 'echo',
      description: 'Echo tool',
      schema: {} as never,
      invoke: async () => 'pong',
    } as unknown as StructuredToolInterface;
    const blocker = createMiddleware({
      name: 'BlockEchoMiddleware',
      wrapToolCall: async (context, handler) => {
        void handler;
        return new ToolMessage({
          content: 'blocked-before-hil',
          tool_call_id: context.toolCall.id ?? 'blocked',
          status: 'error',
        });
      },
    });

    const agent = await createCodaraAgent({
      model: model as unknown as BaseChatModel,
      tools: [tool],
      skills: false,
      hil: {
        interruptOn: {
          echo: true,
        },
      },
      middlewares: [blocker],
    });

    const result = await agent.invoke('start');
    const toolMessage = result.state.messages.find((message) => message instanceof ToolMessage) as ToolMessage | undefined;

    expect(result.reason).toBe('complete');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toBe('blocked-before-hil');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('done');
  });

  it('should create and reload a Codara agent through the facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new EchoModel();

    const agent = await createCodaraAgent({
      model: model as unknown as BaseChatModel,
      threadId: 'core-facade-thread',
      checkpointer,
      skills: false,
    });

    const first = await agent.invoke('hello');
    expect(first.reason).toBe('complete');
    expect(String(first.state.messages[first.state.messages.length - 1]?.content)).toBe('seen_humans:1');

    const restored = await loadCodaraAgent({
      model: model as unknown as BaseChatModel,
      threadId: 'core-facade-thread',
      checkpointer,
      skills: false,
    });

    expect(restored).toBeDefined();
    expect(restored?.getState().messages).toHaveLength(2);
  });

  it('should expose a high-level query API through createCodara()', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.query('hello');
    expect(result.reason).toBe('complete');

    const state = await codara.getState();
    expect(state.messages).toHaveLength(2);
    expect(String(state.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should create and reload sessions through the high-level Codara facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    const session = await codara.createSession({
      threadId: 'codara-session-thread',
    });
    await session.query('hello');

    const restored = await codara.loadSession({
      threadId: 'codara-session-thread',
    });

    expect(restored).toBeDefined();
    expect(restored?.getState().messages).toHaveLength(2);
    expect(String(restored?.getState().messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should open an existing session when thread checkpoints already exist', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const firstCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      threadId: 'codara-open-thread',
      skills: false,
      builtinTools: false,
    });

    await firstCodara.query('hello');

    const secondCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      threadId: 'codara-open-thread',
      skills: false,
      builtinTools: false,
    });

    const restoredState = await secondCodara.getState();
    expect(restoredState.messages).toHaveLength(2);
    expect(String(restoredState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should open a new session when the target thread does not exist yet', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer: createAgentMemoryCheckpointer(),
      skills: false,
      builtinTools: false,
    });

    const session = await codara.openSession({
      threadId: 'brand-new-thread',
    });

    expect(session.getThreadId()).toBe('brand-new-thread');
    expect(session.getState().messages).toHaveLength(0);
  });

  it('should allow a modelResolver override without changing the main createCodaraAgent API', async () => {
    const model = new EchoModel();
    const agent = await createCodaraAgent({
      modelResolver: async () => model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await agent.invoke('hello');
    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
  });

  it('should recreate the default session after dispose', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.query('hello');
    await codara.dispose();

    const result = await codara.query('again');
    expect(result.reason).toBe('complete');

    const state = await codara.getState();
    expect(state.messages).toHaveLength(2);
    expect(String(state.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should stream through the top-level Codara facade for CLI consumers', async () => {
    const model = new StreamingEchoModel();
    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('hello', {streamMode: 'messages'})) {
      const [messageChunk] = chunk as AgentStreamMessagesChunk;
      chunks.push(String(messageChunk.content));
    }

    expect(chunks).toEqual(['seen_humans:1']);
    const state = await codara.getState();
    expect(state.messages).toHaveLength(2);
    expect(String(state.messages[1]?.content)).toBe('seen_humans:1');
  });
});

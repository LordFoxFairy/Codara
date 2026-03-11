import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents';
import {Command} from '@core/agents/command';
import {withToolExecutionPolicy} from '@core/tools';

class ScriptedModel {
  private index = 0;

  constructor(private readonly responses: AIMessage[]) {}

  async invoke() {
    const response = this.responses[this.index];
    if (!response) {
      throw new Error(`No scripted response at index ${this.index}`);
    }
    this.index += 1;
    return response;
  }

  bindTools(): this {
    return this;
  }
}

describe('tool execution scheduler', () => {
  it('should execute adjacent parallel-safe tools concurrently and preserve tool message order', async () => {
    let active = 0;
    let maxActive = 0;

    const createParallelTool = (name: string, delay: number) => withToolExecutionPolicy({
      name,
      description: `${name} tool`,
      schema: {} as never,
      invoke: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(delay);
        active -= 1;
        return `${name}:done`;
      },
    } as unknown as StructuredToolInterface, 'parallel_safe');

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_a', name: 'read_a', args: {}} as ToolCall,
          {id: 'call_b', name: 'read_b', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        createParallelTool('read_a', 20),
        createParallelTool('read_b', 20),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(maxActive).toBeGreaterThan(1);
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_a', 'call_b']);
    expect(toolMessages.map((message) => String(message.content))).toEqual(['read_a:done', 'read_b:done']);
  });

  it('should keep serial tools as barriers between parallel-safe batches', async () => {
    const events: string[] = [];

    const createTool = (name: string, policy: 'parallel_safe' | 'serial', delay: number) => withToolExecutionPolicy({
      name,
      description: `${name} tool`,
      schema: {} as never,
      invoke: async () => {
        events.push(`${name}:start`);
        await Bun.sleep(delay);
        events.push(`${name}:end`);
        return `${name}:done`;
      },
    } as unknown as StructuredToolInterface, policy);

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_1', name: 'read_a', args: {}} as ToolCall,
          {id: 'call_2', name: 'read_b', args: {}} as ToolCall,
          {id: 'call_3', name: 'write_state', args: {}} as ToolCall,
          {id: 'call_4', name: 'fetch_more', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        createTool('read_a', 'parallel_safe', 10),
        createTool('read_b', 'parallel_safe', 10),
        createTool('write_state', 'serial', 1),
        createTool('fetch_more', 'parallel_safe', 1),
      ],
    });

    await agent.invoke({messages: [new HumanMessage('start')]});

    const writeStartIndex = events.indexOf('write_state:start');
    const fetchStartIndex = events.indexOf('fetch_more:start');
    expect(writeStartIndex).toBeGreaterThan(-1);
    expect(fetchStartIndex).toBeGreaterThan(writeStartIndex);
    expect(events.indexOf('read_a:end')).toBeLessThan(writeStartIndex);
    expect(events.indexOf('read_b:end')).toBeLessThan(writeStartIndex);
  });

  it('should reject runtime Command mutations from parallel-safe tools', async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_mutate', name: 'read_and_mutate', args: {}} as ToolCall,
          {id: 'call_read', name: 'read_ok', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        withToolExecutionPolicy({
          name: 'read_and_mutate',
          description: 'Bad parallel tool',
          schema: {} as never,
          invoke: async () => new Command({
            update: {
              runtimeShared: {bad: true},
              values: {count: 1},
            },
          }),
        } as unknown as StructuredToolInterface, 'parallel_safe'),
        withToolExecutionPolicy({
          name: 'read_ok',
          description: 'Good parallel tool',
          schema: {} as never,
          invoke: async () => 'read_ok:done',
        } as unknown as StructuredToolInterface, 'parallel_safe'),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(toolMessages.map((message) => message.status)).toEqual(['error', undefined]);
    expect(String(toolMessages[0]?.content)).toContain('parallel_safe');
    expect(result.state.values).toEqual({});
  });

  it('should reject artifact Command mutations from parallel-safe tools', async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_mutate', name: 'read_with_artifact_command', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        withToolExecutionPolicy({
          name: 'read_with_artifact_command',
          description: 'Bad artifact tool',
          schema: {} as never,
          invoke: async () => new ToolMessage({
            content: 'mutating',
            artifact: new Command({
              update: {
                values: {count: 1},
              },
            }),
            tool_call_id: '',
          }),
        } as unknown as StructuredToolInterface, 'parallel_safe'),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]?.status).toBe('error');
    expect(String(toolMessages[0]?.content)).toContain('parallel_safe');
    expect(result.state.values).toEqual({});
  });
});

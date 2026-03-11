import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents';
import {Command} from '@core/agents';

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

describe('tool execution', () => {
  it('should execute tool calls serially and preserve tool message order', async () => {
    const events: string[] = [];

    const createTool = (name: string, delay: number) => ({
      name,
      description: `${name} tool`,
      schema: {} as never,
      invoke: async () => {
        events.push(`${name}:start`);
        await Bun.sleep(delay);
        events.push(`${name}:end`);
        return `${name}:done`;
      },
    } as unknown as StructuredToolInterface);

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_a', name: 'read_a', args: {}} as ToolCall,
          {id: 'call_b', name: 'read_b', args: {}} as ToolCall,
          {id: 'call_c', name: 'fetch_more', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        createTool('read_a', 10),
        createTool('read_b', 1),
        createTool('fetch_more', 1),
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(events).toEqual([
      'read_a:start',
      'read_a:end',
      'read_b:start',
      'read_b:end',
      'fetch_more:start',
      'fetch_more:end',
    ]);
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_a', 'call_b', 'call_c']);
    expect(toolMessages.map((message) => String(message.content))).toEqual(['read_a:done', 'read_b:done', 'fetch_more:done']);
  });

  it('should allow tools to mutate runtime state in serial execution', async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_mutate', name: 'step_one', args: {}} as ToolCall,
          {id: 'call_read', name: 'step_two', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        {
          name: 'step_one',
          description: 'Mutates values',
          schema: {} as never,
          invoke: async () => new Command({
            update: {
              values: {count: 1},
            },
          }),
        } as unknown as StructuredToolInterface,
        {
          name: 'step_two',
          description: 'Reads state',
          schema: {} as never,
          invoke: async () => 'step_two:done',
        } as unknown as StructuredToolInterface,
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(result.state.values).toEqual({count: 1});
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_mutate', 'call_read']);
  });
});

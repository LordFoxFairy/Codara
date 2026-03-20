import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agent';
import {Command} from '@core/agent';
import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {MemorySharedState} from '@capability/team/shared-state';
import {createConversationTeamToolsWithMode} from '@capability/team/surface/conversation-tools';

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

  it('should expose same-turn context updates to later tool calls in the same response', async () => {
    let observedActiveTeamId: string | undefined;

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'call_mutate_context', name: 'set_team', args: {}} as ToolCall,
          {id: 'call_read_context', name: 'read_team', args: {}} as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: [
        {
          name: 'set_team',
          description: 'Writes team focus to context',
          schema: {} as never,
          invoke: async () => new Command({
            update: {
              context: {
                teamSurface: {
                  activeTeamId: 'team_same_turn',
                  teamRole: 'leader',
                  teamMode: 'leader',
                },
              },
            },
          }),
        } as unknown as StructuredToolInterface,
        {
          name: 'read_team',
          description: 'Reads team focus from context',
          schema: {} as never,
          invoke: async (_args: unknown, config?: {configurable?: {context?: Record<string, unknown>}}) => {
            observedActiveTeamId = (
              config?.configurable?.context?.teamSurface as {activeTeamId?: string} | undefined
            )?.activeTeamId;
            return observedActiveTeamId ?? 'missing';
          },
        } as unknown as StructuredToolInterface,
      ],
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];

    expect(observedActiveTeamId).toBe('team_same_turn');
    expect(toolMessages.map((message) => String(message.content))).toEqual(['Command applied.', 'team_same_turn']);
  });

  it('should let create_team and spawn_teammate succeed in the same parent response', async () => {
    const registry = new TeamRegistry();
    const runtime = new TeamRuntime({
      registry,
      projectRoot: '/tmp/team-same-turn',
      createSession: () => ({
        invoke: async () => ({reason: 'complete' as const}),
        dispose: async () => {},
      }),
    });
    const sharedState = new MemorySharedState();

    const model = new ScriptedModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'call_create_team',
            name: 'create_team',
            args: {
              goal: 'Analyze the project',
              name: 'analysis-team',
            },
          } as ToolCall,
          {
            id: 'call_spawn_teammate',
            name: 'spawn_teammate',
            args: {
              name: '架构分析员',
            },
          } as ToolCall,
        ],
      }),
      new AIMessage('done'),
    ]) as unknown as BaseChatModel;

    const agent = createAgent({
      model,
      tools: createConversationTeamToolsWithMode({registry, runtime, sharedState}, {includeAdvanced: true}),
    });

    const result = await agent.invoke({messages: [new HumanMessage('start')]});
    const toolMessages = result.state.messages.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
    const spawnMessage = toolMessages.find((message) => message.tool_call_id === 'call_spawn_teammate');

    expect(spawnMessage).toBeDefined();
    expect(String(spawnMessage?.content)).toContain('"status":"spawned"');

    const teams = registry.listTeams();
    expect(teams).toHaveLength(1);
    expect(registry.getMembersByTeam(teams[0]!.teamId)).toEqual([
      expect.objectContaining({
        name: '架构分析员',
        role: 'worker',
      }),
    ]);
    expect(result.state.context?.teamSurface).toEqual({
      activeTeamId: teams[0]!.teamId,
      teamRole: 'leader',
      teamMode: 'leader',
    });
  });
});

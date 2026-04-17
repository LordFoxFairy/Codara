import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, type ToolCall} from '@langchain/core/messages';
import {
  buildActiveItems,
  buildSolidifiedItemsFromRange,
  createToolCallLookup,
  normalizeVisibleAssistantText,
} from '@/cli/features/transcript/model';

describe('cli transcript visibility', () => {
  test('does not keep pre-launch assistant chatter once a running subagent block owns the delegation step', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-visible-before-task-launch',
        prompt: 'delegate it',
        responseBeforeRuntime: 'Let me frame the analysis scope first, then I will proceed.',
        response: '',
        responseRole: 'assistant',
        pendingAgentLaunch: true,
        suppressAgentLaunchResponse: false,
      },
      runtimeEvents: [
        {
          id: 'subagent-run:run-visible',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'agent']);
    expect(items[1]?.content).toContain('Explore(Analyze project)');
    expect(items.some((item) => item.content.includes('frame the analysis scope first'))).toBe(false);
  });

  test('does not preserve previously visible launch prose once an Agent tool call owns delegation in the final transcript', () => {
    const taskCall: ToolCall = {
      id: 'call_task_preserved',
      name: 'Agent',
      args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
    };
    const messages = [
      new HumanMessage('delegate it'),
      new AIMessage({
        content: 'Let me frame the analysis scope first, then I will start the delegation.',
        tool_calls: [taskCall],
      }),
    ];
    const toolLookup = createToolCallLookup(messages);

    const items = buildSolidifiedItemsFromRange(
      messages,
      0,
      messages.length,
      toolLookup,
      new Set([normalizeVisibleAssistantText('Let me frame the analysis scope first, then I will start the delegation.')]),
    );

    expect(items.map((item) => ({role: item.role, content: item.content}))).toEqual([
      {role: 'user', content: 'delegate it'},
    ]);
  });
});

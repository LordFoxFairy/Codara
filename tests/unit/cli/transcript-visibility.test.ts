import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, type ToolCall} from '@langchain/core/messages';
import {
  buildActiveItems,
  buildSolidifiedItemsFromRange,
  createToolCallLookup,
  normalizeVisibleAssistantText,
} from '@/cli/transcript/model';

describe('cli transcript visibility', () => {
  test('keeps already-visible main-agent text after a task runtime block appears', () => {
    const items = buildActiveItems({
      activeTurn: {
        id: 'turn-visible-before-task-launch',
        prompt: 'delegate it',
        response: 'Let me frame the analysis scope first, then I will proceed.',
        responseRole: 'assistant',
        pendingAgentLaunch: true,
        suppressAgentLaunchResponse: false,
      },
      runtimeEvents: [
        {
          id: 'agent-run:run-visible',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          kind: 'agent',
          phase: 'start',
          status: 'running',
          label: 'Delegating Explore: Analyze project',
        },
      ],
    });

    expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'task']);
    expect(items[1]?.content).toContain('frame the analysis scope first');
  });

  test('keeps a previously visible main-agent message when it later becomes solidified', () => {
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
      {role: 'assistant', content: 'Let me frame the analysis scope first, then I will start the delegation.'},
    ]);
  });
});

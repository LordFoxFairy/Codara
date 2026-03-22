import React from 'react';
import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {Text} from 'ink';
import {render} from 'ink-testing-library';
import {
  type SolidifiedItem,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  createToolCallLookup,
  dedupeTrailingTranscriptItemsCoveredByRuntime,
  type TranscriptItem,
} from '@/cli/transcript/model';
import {
  filterSubagentCompletionTranscriptItems,
  orderActiveTranscriptItems,
  useSolidifiedTranscript,
} from '@/cli/hooks/use-solidified-transcript';

describe('solidified transcript model', () => {
  function ActiveItemsProbe(props: Parameters<typeof useSolidifiedTranscript>[0]) {
    const {activeItems} = useSolidifiedTranscript(props);
    return React.createElement(
      Text,
      null,
      JSON.stringify(activeItems.map((item) => ({
        role: item.role,
        content: item.content,
        toolName: item.toolMeta?.toolName,
        summaryLine: item.toolMeta?.summaryLine,
      }))),
    );
  }

  describe('buildSolidifiedItemsFromRange', () => {
    test('should build items from a range of core messages', () => {
      const messages = [
        new HumanMessage('hello'),
        new AIMessage('world'),
        new HumanMessage('second'),
        new AIMessage('reply'),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 4, toolLookup);
      expect(items).toHaveLength(4);
      expect(items[0]?.role).toBe('user');
      expect(items[0]?.content).toBe('hello');
      expect(items[1]?.role).toBe('assistant');
      expect(items[1]?.content).toBe('world');
      expect(items[2]?.role).toBe('user');
      expect(items[2]?.content).toBe('second');
      expect(items[3]?.role).toBe('assistant');
      expect(items[3]?.content).toBe('reply');
    });

    test('should build items from a partial range', () => {
      const messages = [
        new HumanMessage('hello'),
        new AIMessage('world'),
        new HumanMessage('second'),
        new AIMessage('reply'),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 2, 4, toolLookup);
      expect(items).toHaveLength(2);
      expect(items[0]?.content).toBe('second');
      expect(items[1]?.content).toBe('reply');
    });

    test('should include tool result items with toolMeta', () => {
      const bashCall: ToolCall = {id: 'call_bash_1', name: 'bash', args: {command: 'ls'}};
      const messages = [
        new AIMessage({content: '', tool_calls: [bashCall]}),
        new ToolMessage({content: 'file1.ts\nfile2.ts', tool_call_id: 'call_bash_1', name: 'bash'}),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 2, toolLookup);
      expect(items).toHaveLength(1); // AIMessage with empty content is filtered, ToolMessage becomes tool item
      expect(items[0]?.role).toBe('tool');
      expect(items[0]?.toolMeta?.toolName).toBe('bash');
    });

    test('should suppress raw delegated subagent launch tool messages from the transcript', () => {
      const taskCall: ToolCall = {
        id: 'call_task_1',
        name: 'Agent',
        args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
      };
      const messages = [
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Subagent started in background.',
            'run_id: call_123',
            'delegate_id: session:task:call_123',
            'agent: Explore',
          ].join('\n'),
          tool_call_id: 'call_task_1',
          name: 'Agent',
          artifact: {
            type: 'subagent_run_started',
            runId: 'call_123',
            parentSessionId: 'session-1',
            sessionId: 'session:task:call_123',
            agentName: 'Explore',
            label: 'Delegating Explore: Analyze the repo',
          },
        }),
      ];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 2, toolLookup);

      expect(items).toHaveLength(0);
    });

    test('should return empty array for empty range', () => {
      const messages = [new HumanMessage('hello')];
      const toolLookup = createToolCallLookup(messages);

      const items = buildSolidifiedItemsFromRange(messages, 0, 0, toolLookup);
      expect(items).toHaveLength(0);
    });
  });

  describe('buildActiveItems', () => {
    test('should build items from activeTurn', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'hello',
          response: 'streaming...',
          responseRole: 'assistant',
        },
      });

      expect(items).toHaveLength(2);
      expect(items[0]?.role).toBe('user');
      expect(items[0]?.content).toBe('hello');
      expect(items[1]?.role).toBe('assistant');
      expect(items[1]?.content).toBe('streaming...');
    });

    test('should include runtime events when activeTurn is present', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'run it',
          response: '',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      // prompt + running tool
      expect(items.some((i) => i.role === 'user')).toBe(true);
      expect(items.some((i) => i.role === 'tool')).toBe(true);
    });

    test('should place assistant text before and after runtime blocks according to the runtime boundary', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-ordered',
          prompt: 'inspect it',
          responseBeforeRuntime: 'I will inspect the repo first.',
          response: 'I found the issue in the transcript ordering.',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
      expect(items[1]?.content).toBe('I will inspect the repo first.');
      expect(items[3]?.content).toBe('I found the issue in the transcript ordering.');
    });

    test('should hide internal Skill runtime blocks from the active transcript', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-skill-ordered',
          prompt: 'brainstorm',
          responseBeforeRuntime: 'I will load the brainstorming skill first.',
          response: 'Now I can continue with the actual design discussion.',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'evt_skill_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Skill(superworkers:brainstorming)',
            detail: 'Skill',
          },
        ],
      });

      expect(items.map((item) => item.role)).toEqual(['user']);
    });

    test('should hide active assistant prose once the turn has been handed off to an AskUser review', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-ask-handoff',
          prompt: 'brainstorm',
          responseBeforeRuntime: '让我先了解一些基础信息。',
          response: '这段文字不应继续显示。',
          responseRole: 'assistant',
          suppressInteractionResponse: true,
        },
      });

      expect(items.map((item) => item.role)).toEqual(['user']);
    });

    test('should advance running task elapsed time from the supplied clock even without new events', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-running-elapsed',
          prompt: 'go',
          response: '',
          responseRole: 'assistant',
        },
        runtimeEvents: [
          {
            id: 'subagent-run:run-1',
            sessionId: 'session-1',
            timestamp: '2026-03-20T10:00:00.000Z',
            kind: 'agent',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze project',
          },
        ],
        nowTimestamp: '2026-03-20T10:00:03.000Z',
      });

      const agentItem = items.find((item) => item.toolMeta?.toolName === 'Agent');
      expect(agentItem?.toolMeta?.summaryLine).toContain('Running (3.0s)');
      expect(agentItem?.toolMeta?.elapsed).toBe('3.0s');
    });

    test('should include runtime events even without activeTurn', () => {
      const now = new Date().toISOString();
      const items = buildActiveItems({
        runtimeEvents: [
          {
            id: 'evt_bash_start',
            sessionId: 'session-1',
            timestamp: now,
            kind: 'tool',
            phase: 'start',
            status: 'running',
            label: 'Bash(ls)',
            detail: 'bash',
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.role).toBe('tool');
    });

    test('should filter empty content items', () => {
      const items = buildActiveItems({
        activeTurn: {
          id: 'turn-1',
          prompt: 'hello',
          response: '',
          responseRole: 'assistant',
        },
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.content).toBe('hello');
    });

    test('should return empty array with no activeTurn and no events', () => {
      const items = buildActiveItems({});
      expect(items).toHaveLength(0);
    });
  });

  test('should not surface a completed Skill tool result in the active transcript while runtime events are still settling', () => {
    const skillToolCall: ToolCall = {
      id: 'call_skill_1',
      name: 'Skill',
      args: {skill: 'superworkers:brainstorming'},
    };
    const now = new Date().toISOString();
    const {lastFrame} = render(React.createElement(ActiveItemsProbe, {
      notices: [],
      coreMessages: [
        new AIMessage({content: '', tool_calls: [skillToolCall]}),
        new ToolMessage({
          content: '<command-name>superworkers:brainstorming</command-name>\n---\nname: brainstorming',
          tool_call_id: 'call_skill_1',
          name: 'Skill',
        }),
      ],
      runtimeEvents: [
        {
          id: 'evt_skill_start',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: 'Skill(superworkers:brainstorming)',
          detail: 'Skill',
        },
        {
          id: 'evt_skill_end',
          sessionId: 'session-1',
          timestamp: now,
          kind: 'tool',
          phase: 'end',
          status: 'done',
          label: 'Skill(superworkers:brainstorming)',
          detail: '<command-name>superworkers:brainstorming</command-name>\n---\nname: brainstorming',
          parentId: 'evt_skill_start',
        },
      ],
    }));

    const serialized = lastFrame() ?? '';
    expect(serialized.includes('"toolName":"Skill"')).toBe(false);
  });

  describe('orderActiveTranscriptItems', () => {
    test('should place task-completion runtime execution items before the trailing main-agent continuation reply', () => {
      const trailingItems: TranscriptItem[] = [
        {id: 'assistant-final', role: 'assistant', content: 'Unified main-agent summary'},
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-subagent-run:run-1',
          role: 'agent',
          content: '⏺ Explore(Analyze structure)\n  ⎿ Done (5 tool uses · 1.2k tokens · 31s)',
        },
      ];
      const noticeItems: TranscriptItem[] = [
        {id: 'notice-1', role: 'system', content: 'ready'},
      ];

      const ordered = orderActiveTranscriptItems({
        trailingItems,
        runtimeItems,
        activeNoticeItems: noticeItems,
        latestCompletedTurnKind: 'subagent_completion',
      });

      expect(ordered.map((item) => item.id)).toEqual([
        'active-subagent-run:run-1',
        'assistant-final',
        'notice-1',
      ]);
    });

    test('should remove trailing tool items already covered by active runtime items', () => {
      const trailingItems: TranscriptItem[] = [
        {
          id: 'core-skill-result',
          role: 'tool',
          content: '⚙ Skill(superworkers:brainstorming)\n---',
          toolMeta: {
            toolName: 'Skill',
            displayName: 'Skill',
            icon: '⚙',
            args: 'superworkers:brainstorming',
            status: 'done',
            summaryLine: '---',
          },
        },
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-skill-result',
          role: 'tool',
          content: '⚙ Skill(superworkers:brainstorming)\n---',
          toolMeta: {
            toolName: 'Skill',
            displayName: 'Skill',
            icon: '⚙',
            args: 'superworkers:brainstorming',
            status: 'done',
            summaryLine: '---',
            elapsed: '15ms',
          },
        },
      ];

      expect(dedupeTrailingTranscriptItemsCoveredByRuntime(trailingItems, runtimeItems)).toEqual([]);
    });
  });

  describe('filterSubagentCompletionTranscriptItems', () => {
    test('filters invalid task-completion waiting narration from transcript items', () => {
      const items = filterSubagentCompletionTranscriptItems({
        completedTurnKind: 'subagent_completion',
        items: [
          {id: 'assistant-invalid', role: 'assistant', content: 'Phase 1 has started. Waiting for subagent results.'},
          {id: 'task-1', role: 'agent', content: 'Explore(Analyze CLI)\nRunning...'},
          {id: 'assistant-valid', role: 'assistant', content: 'Unified final answer from the main agent.'},
        ],
      });

      expect(items.map((item) => item.id)).toEqual(['task-1', 'assistant-valid']);
    });

    test('keeps assistant items untouched outside task-completion turns', () => {
      const items = filterSubagentCompletionTranscriptItems({
        completedTurnKind: 'prompt',
        items: [
          {id: 'assistant-1', role: 'assistant', content: 'Phase 1 has started. Waiting for subagent results.'},
        ],
      });

      expect(items.map((item) => item.id)).toEqual(['assistant-1']);
    });
  });

  describe('SolidifiedItem type', () => {
    test('should support welcome kind', () => {
      const item: SolidifiedItem = {
        id: 'welcome-1',
        kind: 'welcome',
        items: [],
      };
      expect(item.kind).toBe('welcome');
    });

    test('should support turn kind with items', () => {
      const item: SolidifiedItem = {
        id: 'turn-1',
        kind: 'turn',
        items: [
          {id: 'msg-1', role: 'user', content: 'hello'},
          {id: 'msg-2', role: 'assistant', content: 'world'},
        ],
      };
      expect(item.kind).toBe('turn');
      expect(item.items).toHaveLength(2);
    });

    test('should support notice kind', () => {
      const item: SolidifiedItem = {
        id: 'notice-1',
        kind: 'notice',
        items: [{id: 'n1', role: 'system', content: 'ready'}],
      };
      expect(item.kind).toBe('notice');
    });
  });
});

import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {
  type SolidifiedItem,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  createToolCallLookup,
  type TranscriptItem,
} from '@/cli/transcript/model';
import {orderActiveTranscriptItems} from '@/cli/hooks/use-solidified-transcript';

describe('solidified transcript model', () => {
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

    test('should suppress raw delegated task launch tool messages from the transcript', () => {
      const taskCall: ToolCall = {
        id: 'call_task_1',
        name: 'Task',
        args: {prompt: 'Analyze the repo', subagent_type: 'Explore'},
      };
      const messages = [
        new AIMessage({content: '', tool_calls: [taskCall]}),
        new ToolMessage({
          content: [
            'Delegated task started in background.',
            'run_id: call_123',
            'delegate_id: session:task:call_123',
            'agent: Explore',
          ].join('\n'),
          tool_call_id: 'call_task_1',
          name: 'Task',
          artifact: {
            type: 'task_run_started',
            runId: 'call_123',
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
            id: 'task-run:run-1',
            sessionId: 'session-1',
            timestamp: '2026-03-20T10:00:00.000Z',
            kind: 'task',
            phase: 'start',
            status: 'running',
            label: 'Delegating Explore: Analyze project',
          },
        ],
        nowTimestamp: '2026-03-20T10:00:03.000Z',
      });

      const taskItem = items.find((item) => item.toolMeta?.toolName === 'Task');
      expect(taskItem?.toolMeta?.summaryLine).toContain('Running (3.0s)');
      expect(taskItem?.toolMeta?.elapsed).toBe('3.0s');
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

  describe('orderActiveTranscriptItems', () => {
    test('should place task-completion runtime execution items before the trailing main-agent continuation reply', () => {
      const trailingItems: TranscriptItem[] = [
        {id: 'assistant-final', role: 'assistant', content: 'Unified main-agent summary'},
      ];
      const runtimeItems: TranscriptItem[] = [
        {
          id: 'active-task-run:run-1',
          role: 'task',
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
        latestCompletedTurnKind: 'task_completion',
      });

      expect(ordered.map((item) => item.id)).toEqual([
        'active-task-run:run-1',
        'assistant-final',
        'notice-1',
      ]);
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

import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import {
  type SolidifiedItem,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  createToolCallLookup,
} from '@/cli/transcript/model';

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

    test('should not include runtime events without activeTurn', () => {
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

      expect(items).toHaveLength(0);
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

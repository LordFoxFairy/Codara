import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage} from '@langchain/core/messages';
import {cheapDrainMessages, compactMessages, isContextWindowExhausted} from '@core/agent/run/compact';

describe('compactMessages', () => {
  it('returns empty array for empty input', () => {
    expect(compactMessages([])).toEqual([]);
  });

  it('returns unchanged if fewer turns than keepRecentTurns', () => {
    const messages = [
      new SystemMessage('system prompt'),
      new HumanMessage('hello'),
      new AIMessage('hi'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 3});
    expect(result).toHaveLength(3);
    expect(result[0]).toBeInstanceOf(SystemMessage);
    expect(result[1]).toBeInstanceOf(HumanMessage);
    expect(result[2]).toBeInstanceOf(AIMessage);
  });

  it('preserves all SystemMessages after compaction', () => {
    const messages = [
      new SystemMessage('sys1'),
      new SystemMessage('sys2'),
      new HumanMessage('turn1'),
      new AIMessage('resp1'),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
      new HumanMessage('turn3'),
      new AIMessage('resp3'),
      new HumanMessage('turn4'),
      new AIMessage('resp4'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 2});

    // Both original system messages should be preserved
    const systemMessages = result.filter(m => m instanceof SystemMessage);
    expect(systemMessages.length).toBeGreaterThanOrEqual(2);
    expect(systemMessages[0].content).toBe('sys1');
    expect(systemMessages[1].content).toBe('sys2');
  });

  it('keeps recent N turns', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage('resp1'),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
      new HumanMessage('turn3'),
      new AIMessage('resp3'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 2});

    // Should have: summary + turn2 (human+ai) + turn3 (human+ai)
    const humanMessages = result.filter(m => m instanceof HumanMessage);
    expect(humanMessages).toHaveLength(2);
    expect(humanMessages[0].content).toBe('turn2');
    expect(humanMessages[1].content).toBe('turn3');
  });

  it('groups AIMessage + ToolMessage into same turn (never splits pairs)', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read_file', args: {path: '/foo'}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'file contents', tool_call_id: 'tc1'}),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
      new HumanMessage('turn3'),
      new AIMessage('resp3'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 2});

    // turn1 (human + ai + tool) is dropped; turn2 and turn3 kept
    const toolMessages = result.filter(m => m instanceof ToolMessage);
    expect(toolMessages).toHaveLength(0);

    const humanMessages = result.filter(m => m instanceof HumanMessage);
    expect(humanMessages).toHaveLength(2);
    expect(humanMessages[0].content).toBe('turn2');
  });

  it('summary includes tool names from dropped messages', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage({
        content: '',
        tool_calls: [
          {id: 'tc1', name: 'read_file', args: {}, type: 'tool_call'},
          {id: 'tc2', name: 'search', args: {}, type: 'tool_call'},
        ],
      }),
      new ToolMessage({content: 'result1', tool_call_id: 'tc1'}),
      new ToolMessage({content: 'result2', tool_call_id: 'tc2'}),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 1});

    const summaryMessages = result.filter(
      m => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('[Conversation compacted]'),
    );
    expect(summaryMessages).toHaveLength(1);

    const summaryContent = summaryMessages[0].content as string;
    expect(summaryContent).toContain('read_file');
    expect(summaryContent).toContain('search');
    expect(summaryContent).toContain('4 earlier messages');
  });

  it('produces no summary when nothing is dropped', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage('resp1'),
    ];
    const result = compactMessages(messages, {keepRecentTurns: 5});

    const summaryMessages = result.filter(
      m => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('[Conversation compacted]'),
    );
    expect(summaryMessages).toHaveLength(0);
  });
});

describe('cheapDrainMessages', () => {
  it('returns unchanged when fewer turns than keepRecentTurns', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read', args: {}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'x'.repeat(300), tool_call_id: 'tc1'}),
    ];
    const result = cheapDrainMessages(messages, 3);
    expect(result.freedCount).toBe(0);
    expect(result.messages).toHaveLength(3);
  });

  it('strips large tool results from older turns', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read', args: {}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'x'.repeat(300), tool_call_id: 'tc1'}),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
    ];
    const result = cheapDrainMessages(messages, 1);
    expect(result.freedCount).toBe(1);
    // The old tool message should be replaced with placeholder
    const toolMsg = result.messages.find(m => m instanceof ToolMessage);
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('[tool result removed to free context]');
  });

  it('preserves small tool results in older turns', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read', args: {}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'short', tool_call_id: 'tc1'}),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
    ];
    const result = cheapDrainMessages(messages, 1);
    expect(result.freedCount).toBe(0);
  });

  it('preserves recent turn tool results', () => {
    const messages = [
      new HumanMessage('turn1'),
      new AIMessage('resp1'),
      new HumanMessage('turn2'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read', args: {}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'x'.repeat(300), tool_call_id: 'tc1'}),
    ];
    const result = cheapDrainMessages(messages, 1);
    // turn2 is the last turn, so its large tool result should be preserved
    expect(result.freedCount).toBe(0);
  });

  it('preserves SystemMessages', () => {
    const messages = [
      new SystemMessage('system'),
      new HumanMessage('turn1'),
      new AIMessage({
        content: '',
        tool_calls: [{id: 'tc1', name: 'read', args: {}, type: 'tool_call'}],
      }),
      new ToolMessage({content: 'x'.repeat(300), tool_call_id: 'tc1'}),
      new HumanMessage('turn2'),
      new AIMessage('resp2'),
    ];
    const result = cheapDrainMessages(messages, 1);
    const sysMessages = result.messages.filter(m => m instanceof SystemMessage);
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0].content).toBe('system');
  });
});

describe('isContextWindowExhausted', () => {
  it('returns false for non-Error values', () => {
    expect(isContextWindowExhausted('string error')).toBe(false);
    expect(isContextWindowExhausted(null)).toBe(false);
    expect(isContextWindowExhausted(undefined)).toBe(false);
    expect(isContextWindowExhausted(42)).toBe(false);
  });

  it('recognizes "context length exceeded"', () => {
    expect(isContextWindowExhausted(new Error('context length exceeded'))).toBe(true);
  });

  it('recognizes "maximum context length"', () => {
    expect(isContextWindowExhausted(new Error('maximum context length reached'))).toBe(true);
  });

  it('recognizes "too many tokens"', () => {
    expect(isContextWindowExhausted(new Error('Request has too many tokens'))).toBe(true);
  });

  it('recognizes "prompt is too long"', () => {
    expect(isContextWindowExhausted(new Error('prompt is too long for this model'))).toBe(true);
  });

  it('recognizes "context_length_exceeded" error code', () => {
    expect(isContextWindowExhausted(new Error('Error code: context_length_exceeded'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isContextWindowExhausted(new Error('network timeout'))).toBe(false);
    expect(isContextWindowExhausted(new Error('rate limit exceeded'))).toBe(false);
  });
});

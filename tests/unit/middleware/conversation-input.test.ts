import {describe, expect, it} from 'bun:test';
import {HumanMessage, SystemMessage} from '@langchain/core/messages';
import {buildConversationMessages} from '@core/middleware/conversation-input';

describe('conversation input helpers', () => {
  it('should build the exact model message list from system prompt sections and conversation messages', () => {
    const built = buildConversationMessages({
      systemMessage: ['rule one', 'rule two'],
      messages: [new HumanMessage('hello')],
    });

    expect(built.systemMessages).toHaveLength(2);
    expect(built.systemMessages[0]).toBeInstanceOf(SystemMessage);
    expect(String(built.systemMessages[0]?.content)).toBe('rule one');
    expect(String(built.systemMessages[1]?.content)).toBe('rule two');
    expect(built.modelMessages).toHaveLength(3);
    expect(String(built.modelMessages[2]?.content)).toBe('hello');
  });
});

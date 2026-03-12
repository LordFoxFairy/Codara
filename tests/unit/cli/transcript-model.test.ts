import {describe, expect, test} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage} from '@langchain/core/messages';
import {buildTranscriptItems, hasTranscriptContent} from '@/cli/transcript/model';

describe('cli transcript model', () => {
  test('should build transcript items from notices, core messages, and active turn', () => {
    const items = buildTranscriptItems({
      notices: [
        {id: 'n1', level: 'system', content: 'ready'},
        {id: 'n2', level: 'warning', content: 'careful'},
      ],
      coreMessages: [new HumanMessage('hello'), new AIMessage('world')],
      activeTurn: {
        id: 'turn-1',
        prompt: 'draft',
        response: 'streaming',
        responseRole: 'assistant',
      },
    });

    expect(items.map((item) => `${item.role}:${item.content}`)).toEqual([
      'system:ready',
      'warning:careful',
      'user:hello',
      'assistant:world',
      'user:draft',
      'assistant:streaming',
    ]);
  });

  test('should treat notice-only output as transcript content after startup', () => {
    expect(hasTranscriptContent({
      coreMessages: [],
      notices: [
        {id: 'startup', level: 'system', content: 'startup'},
        {id: 'result', level: 'system', content: 'slash output'},
      ],
      initialNoticeCount: 1,
    })).toBe(true);
  });

  test('should treat non-empty core system messages as transcript content', () => {
    expect(hasTranscriptContent({
      coreMessages: [new SystemMessage('system note')],
      notices: [{id: 'startup', level: 'system', content: 'startup'}],
      initialNoticeCount: 1,
    })).toBe(true);
  });
});

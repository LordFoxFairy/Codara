import {describe, expect, it} from 'bun:test';
import {AIMessageChunk} from '@langchain/core/messages';
import {
  appendCliActiveTurnResponse,
  appendCliActiveTurnThinking,
  createCliActiveTurn,
  ensureCliActiveTurnResponse,
  extractCliStreamingTokenCounts,
  extractCliThinkingText,
  mergeCliActiveTurnStreamingTokens,
} from '@/cli/app/streaming-active-turn';

describe('CLI streaming active turn helper', () => {
  it('creates a fresh active turn for assistant streaming', () => {
    expect(createCliActiveTurn({
      id: 'turn-1',
      prompt: 'hello',
    })).toEqual({
      id: 'turn-1',
      prompt: 'hello',
      response: '',
      responseRole: 'assistant',
    });
  });

  it('merges thinking text, streamed response text, and token counts onto the turn', () => {
    const base = createCliActiveTurn({id: 'turn-1', prompt: 'hello'});
    const withThinking = appendCliActiveTurnThinking(base, 'step-1');
    const withResponse = appendCliActiveTurnResponse(withThinking, 'done');
    const withTokens = mergeCliActiveTurnStreamingTokens(withResponse, {input: 12, output: 4});

    expect(withTokens).toEqual({
      id: 'turn-1',
      prompt: 'hello',
      response: 'done',
      responseRole: 'assistant',
      thinking: 'step-1',
      streamingTokens: {input: 12, output: 4},
    });
  });

  it('fills the fallback response only when nothing streamed', () => {
    const empty = createCliActiveTurn({id: 'turn-1', prompt: 'hello'});
    const withFallback = ensureCliActiveTurnResponse(empty);
    const alreadyFilled = ensureCliActiveTurnResponse(appendCliActiveTurnResponse(empty, 'real output'));

    expect(withFallback?.response).toBe('(no output)');
    expect(alreadyFilled?.response).toBe('real output');
  });

  it('extracts thinking text and streaming token counts from AI chunks', () => {
    const chunk = new AIMessageChunk({
      content: [
        {type: 'thinking', thinking: 'first '},
        {type: 'thinking', thinking: 'second'},
      ],
      usage_metadata: {
        input_tokens: 10,
        output_tokens: 3,
      },
    });

    expect(extractCliThinkingText(chunk)).toBe('first second');
    expect(extractCliStreamingTokenCounts(chunk)).toEqual({input: 10, output: 3});
  });
});

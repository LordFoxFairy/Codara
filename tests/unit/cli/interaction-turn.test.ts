import {describe, expect, it} from 'bun:test';
import {AIMessageChunk} from '@langchain/core/messages';
import {appendInteractionText, applyInteractionChunkToTurn, extractThinkingText} from '@/cli/app/interaction-turn';

describe('CLI interaction turn helpers', () => {
  it('projects message chunks into an active turn with reasoning, token counts, task launch markers, and text', () => {
    const chunk = new AIMessageChunk({
      content: [
        {type: 'thinking', thinking: 'First thought. '},
        {type: 'thinking', thinking: 'Second thought.'},
        {type: 'text', text: 'Visible answer'},
      ],
      tool_calls: [{name: 'Task', id: 'call-1', args: {prompt: 'delegate'}}],
      usage_metadata: {
        input_tokens: 120,
        output_tokens: 45,
      },
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-1',
      prompt: 'hello',
      response: 'Existing ',
      responseRole: 'assistant',
    }, chunk, {
      captureThinking: true,
      detectTaskLaunch: true,
    });

    expect(result.sawText).toBe(true);
    expect(result.turn).toEqual(expect.objectContaining({
      response: 'Existing Visible answer',
      thinking: 'First thought. Second thought.',
      pendingTaskLaunch: true,
      streamingTokens: {
        input: 120,
        output: 45,
      },
    }));
  });

  it('appends resume text into an existing or fallback turn', () => {
    expect(appendInteractionText(undefined, 'hello', {
      id: 'fallback',
      prompt: '',
      responseRole: 'assistant',
    })).toEqual({
      id: 'fallback',
      prompt: '',
      response: 'hello',
      responseRole: 'assistant',
    });

    expect(appendInteractionText({
      id: 'turn-2',
      prompt: 'p',
      response: 'hello',
      responseRole: 'assistant',
    }, ' world', {
      id: 'fallback',
      prompt: '',
      responseRole: 'assistant',
    })).toEqual({
      id: 'turn-2',
      prompt: 'p',
      response: 'hello world',
      responseRole: 'assistant',
    });
  });

  it('extracts thinking text only from thinking blocks', () => {
    const chunk = new AIMessageChunk({
      content: [
        {type: 'thinking', thinking: 'A'},
        {type: 'text', text: 'B'},
        {type: 'thinking', thinking: 'C'},
      ],
    });

    expect(extractThinkingText(chunk)).toBe('AC');
  });
});

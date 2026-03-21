import {describe, expect, it} from 'bun:test';
import {AIMessageChunk} from '@langchain/core/messages';
import {
  appendInteractionText,
  applyInteractionChunkToTurn,
  extractThinkingText,
  finalizeBufferedInteractionText,
  sealActiveTurnAtRuntimeBoundary,
} from '@/cli/app/interaction-turn';

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

  it('suppresses assistant prose when the streaming turn delegates to an internal interaction tool', () => {
    const chunk = new AIMessageChunk({
      content: [
        {type: 'text', text: '让我先了解一些基础信息。'},
      ],
      tool_calls: [{name: 'AskUserQuestion', id: 'call-ask', args: {summary: 'Clarify'}}],
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-ask',
      prompt: 'brainstorm',
      response: 'Earlier prose',
      responseRole: 'assistant',
    }, chunk);

    expect(result.sawText).toBe(false);
    expect(result.turn).toEqual(expect.objectContaining({
      response: '',
      suppressInteractionResponse: true,
    }));
  });

  it('buffers prompt-surface assistant text until the turn outcome is known', () => {
    const chunk = new AIMessageChunk({
      content: [{type: 'text', text: 'Buffered answer'}],
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-prompt',
      prompt: 'hello',
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    }, chunk);

    expect(result.sawText).toBe(false);
    expect(result.turn).toEqual(expect.objectContaining({
      response: '',
      pendingResponse: 'Buffered answer',
      kind: 'prompt',
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

  it('seals the current assistant text into a pre-runtime segment when the first visible runtime block starts', () => {
    expect(sealActiveTurnAtRuntimeBoundary({
      id: 'turn-3',
      prompt: 'p',
      pendingResponse: 'I will inspect the repo first.',
      response: '',
      responseRole: 'assistant',
    })).toEqual({
      id: 'turn-3',
      prompt: 'p',
      pendingResponse: undefined,
      response: '',
      responseBeforeRuntime: 'I will inspect the repo first.',
      responseRole: 'assistant',
    });
  });

  it('does not reseal or mutate an active turn that already crossed a runtime boundary', () => {
    expect(sealActiveTurnAtRuntimeBoundary({
      id: 'turn-4',
      prompt: 'p',
      response: 'Post-tool summary',
      responseBeforeRuntime: 'I will inspect the repo first.',
      responseRole: 'assistant',
    })).toEqual({
      id: 'turn-4',
      prompt: 'p',
      response: 'Post-tool summary',
      responseBeforeRuntime: 'I will inspect the repo first.',
      responseRole: 'assistant',
    });
  });

  it('finalizes buffered prompt text once the stream ends without an internal interaction handoff', () => {
    expect(finalizeBufferedInteractionText({
      id: 'turn-5',
      prompt: 'p',
      pendingResponse: 'Final streamed answer.',
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    })).toEqual({
      id: 'turn-5',
      prompt: 'p',
      pendingResponse: undefined,
      response: 'Final streamed answer.',
      responseRole: 'assistant',
      kind: 'prompt',
    });
  });
});

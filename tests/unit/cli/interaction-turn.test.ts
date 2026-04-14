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
      tool_calls: [{name: 'Agent', id: 'call-1', args: {prompt: 'delegate'}}],
      usage_metadata: {
        input_tokens: 120,
        output_tokens: 45,
        total_tokens: 165,
      },
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-1',
      prompt: 'hello',
      response: 'Existing ',
      responseRole: 'assistant',
    }, chunk, {
      captureThinking: true,
      detectAgentLaunch: true,
    });

    expect(result.sawText).toBe(false);
    expect(result.turn).toEqual(expect.objectContaining({
      response: '',
      thinking: 'First thought. Second thought.',
      pendingAgentLaunch: true,
      suppressAgentLaunchResponse: true,
      streamingTokens: {
        input: 120,
        output: 45,
      },
    }));
  });

  it('retroactively clears buffered assistant launch chatter once an Agent tool call appears', () => {
    const chunk = new AIMessageChunk({
      content: [{type: 'text', text: '我将立即并行委派两个只读 Explore subagent。'}],
      tool_calls: [{name: 'Agent', id: 'call-agent', args: {prompt: 'analyze src/cli'}}],
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-launch',
      prompt: 'analyze repo',
      response: 'Earlier launch prose',
      pendingResponse: 'Buffered launch prose',
      responseBeforeRuntime: 'Buffered before runtime',
      responseRole: 'assistant',
      kind: 'prompt',
    }, chunk, {
      detectAgentLaunch: true,
    });

    expect(result.sawText).toBe(false);
    expect(result.turn).toEqual(expect.objectContaining({
      pendingAgentLaunch: true,
      suppressAgentLaunchResponse: true,
      pendingResponse: undefined,
      responseBeforeRuntime: undefined,
      response: '',
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

  it('clears buffered prompt text when an internal interaction tool takes over the turn', () => {
    const chunk = new AIMessageChunk({
      content: [{type: 'text', text: 'Need a structured follow-up.'}],
      tool_calls: [{name: 'Skill', id: 'call-skill', args: {skill: 'brainstorming'}}],
    });

    const result = applyInteractionChunkToTurn({
      id: 'turn-skill',
      prompt: 'help me',
      response: '',
      pendingResponse: 'Buffered preamble',
      responseRole: 'assistant',
      kind: 'prompt',
    }, chunk);

    expect(result.turn).toEqual(expect.objectContaining({
      pendingResponse: undefined,
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

    expect(result.sawText).toBe(true);
    expect(result.turn).toEqual(expect.objectContaining({
      response: '',
      pendingResponse: 'Buffered answer',
      kind: 'prompt',
    }));
  });

  it('drops launch chatter but allows the later final main reply in the same prompt stream once the text is no longer launch prose', () => {
    const launchTurn = applyInteractionChunkToTurn({
      id: 'turn-agent-followthrough',
      prompt: 'delegate',
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    }, new AIMessageChunk({
      tool_calls: [{name: 'Agent', id: 'call-agent', args: {}}],
    }), {
      detectAgentLaunch: true,
    }).turn;

    const suppressedLaunch = applyInteractionChunkToTurn(launchTurn, new AIMessageChunk({
      content: [{type: 'text', text: '我将立即并行委派两个只读 Explore subagent。'}],
    }));
    expect(suppressedLaunch.sawText).toBe(false);
    expect(suppressedLaunch.turn).toEqual(expect.objectContaining({
      pendingAgentLaunch: true,
      suppressAgentLaunchResponse: true,
      response: '',
      pendingResponse: undefined,
    }));

    const finalReply = applyInteractionChunkToTurn(suppressedLaunch.turn, new AIMessageChunk({
      content: [{type: 'text', text: '最终答案：CLI 和 Capability 的边界已经梳理清楚。'}],
    }));
    expect(finalReply.sawText).toBe(true);
    expect(finalReply.turn).toEqual(expect.objectContaining({
      pendingAgentLaunch: false,
      suppressAgentLaunchResponse: false,
      pendingResponse: '最终答案：CLI 和 Capability 的边界已经梳理清楚。',
    }));
  });

  it('suppresses child-style subagent continuation text before it enters the active turn response buffer', () => {
    const result = applyInteractionChunkToTurn({
      id: 'turn-subagent-completion',
      prompt: 'delegate',
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    }, new AIMessageChunk({
      content: [{type: 'text', text: 'src/cli 目录架构分析报告\n\n1. 目录结构\n- app/\n- components/'}],
    }), {
      shouldSuppressText: (text) => text.includes('目录架构分析报告'),
    });

    expect(result.sawText).toBe(false);
    expect(result.turn).toEqual(expect.objectContaining({
      response: '',
    }));
    expect(result.turn?.pendingResponse).toBeUndefined();
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

  it('clears launch-chatter suppression once runtime ownership begins so post-subagent text can stream normally', () => {
    expect(sealActiveTurnAtRuntimeBoundary({
      id: 'turn-agent',
      prompt: 'delegate',
      response: '',
      responseRole: 'assistant',
      pendingAgentLaunch: true,
      suppressAgentLaunchResponse: true,
      pendingResponse: '我将立即并行委派两个只读 Explore subagent。',
    })).toEqual({
      id: 'turn-agent',
      prompt: 'delegate',
      response: '',
      responseRole: 'assistant',
      pendingAgentLaunch: false,
      suppressAgentLaunchResponse: false,
      pendingResponse: undefined,
      responseBeforeRuntime: undefined,
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

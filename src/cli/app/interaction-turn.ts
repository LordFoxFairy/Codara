import {AIMessageChunk} from '@langchain/core/messages';
import type {CliActiveTurn} from './view-state';

export interface ApplyInteractionChunkOptions {
  captureThinking?: boolean;
  detectTaskLaunch?: boolean;
}

export interface ApplyInteractionChunkResult {
  turn: CliActiveTurn | undefined;
  sawText: boolean;
}

export function applyInteractionChunkToTurn(
  turn: CliActiveTurn | undefined,
  chunk: AIMessageChunk,
  options: ApplyInteractionChunkOptions = {},
): ApplyInteractionChunkResult {
  if (!turn) {
    return {turn, sawText: false};
  }

  let next = turn;

  if (options.captureThinking) {
    const thinkingText = extractThinkingText(chunk);
    if (thinkingText) {
      next = {...next, thinking: (next.thinking ?? '') + thinkingText};
    }
  }

  const usageMeta = chunk.usage_metadata as Record<string, unknown> | undefined;
  if (usageMeta) {
    const inputDelta = typeof usageMeta.input_tokens === 'number' ? usageMeta.input_tokens : 0;
    const outputDelta = typeof usageMeta.output_tokens === 'number' ? usageMeta.output_tokens : 0;
    if (inputDelta > 0 || outputDelta > 0) {
      const prev = next.streamingTokens ?? {input: 0, output: 0};
      next = {
        ...next,
        streamingTokens: {
          input: Math.max(prev.input, inputDelta),
          output: Math.max(prev.output, outputDelta),
        },
      };
    }
  }

  if (options.detectTaskLaunch && Array.isArray(chunk.tool_calls) && chunk.tool_calls.some((toolCall) => toolCall?.name === 'Task')) {
    next = {...next, pendingTaskLaunch: true};
  }

  const text = chunk.text;
  if (!text) {
    return {turn: next, sawText: false};
  }

  return {
    turn: {
      ...next,
      response: next.response + text,
    },
    sawText: true,
  };
}

export function appendInteractionText(
  turn: CliActiveTurn | undefined,
  text: string,
  fallback: Omit<CliActiveTurn, 'response'> & {response?: string},
): CliActiveTurn {
  if (turn) {
    return {...turn, response: turn.response + text};
  }

  return {
    ...fallback,
    response: (fallback.response ?? '') + text,
  };
}

/**
 * Extract thinking/reasoning text from an AIMessageChunk.
 * Anthropic Extended Thinking emits content blocks with type "thinking".
 */
export function extractThinkingText(chunk: AIMessageChunk): string | undefined {
  const content = chunk.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  let thinking = '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const typed = block as {type: string; thinking?: string};
      if (typed.type === 'thinking' && typed.thinking) {
        thinking += typed.thinking;
      }
    }
  }
  return thinking || undefined;
}

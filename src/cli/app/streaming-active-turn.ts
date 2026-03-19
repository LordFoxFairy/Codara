import {AIMessageChunk} from '@langchain/core/messages';
import type {CliActiveTurn} from './view-state';

export interface StreamingTokenCounts {
  input: number;
  output: number;
}

export function createCliActiveTurn(input: {
  id: string;
  prompt: string;
  responseRole?: CliActiveTurn['responseRole'];
}): CliActiveTurn {
  return {
    id: input.id,
    prompt: input.prompt,
    response: '',
    responseRole: input.responseRole ?? 'assistant',
  };
}

export function appendCliActiveTurnThinking(
  current: CliActiveTurn | undefined,
  thinkingText: string,
): CliActiveTurn | undefined {
  if (!current || !thinkingText) {
    return current;
  }

  return {
    ...current,
    thinking: (current.thinking ?? '') + thinkingText,
  };
}

export function mergeCliActiveTurnStreamingTokens(
  current: CliActiveTurn | undefined,
  counts: StreamingTokenCounts | undefined,
): CliActiveTurn | undefined {
  if (!current || !counts) {
    return current;
  }

  const prev = current.streamingTokens ?? {input: 0, output: 0};
  return {
    ...current,
    streamingTokens: {
      input: Math.max(prev.input, counts.input),
      output: Math.max(prev.output, counts.output),
    },
  };
}

export function appendCliActiveTurnResponse(
  current: CliActiveTurn | undefined,
  text: string,
): CliActiveTurn | undefined {
  if (!current || !text) {
    return current;
  }

  return {
    ...current,
    response: current.response + text,
  };
}

export function ensureCliActiveTurnResponse(
  current: CliActiveTurn | undefined,
  fallback: string = '(no output)',
): CliActiveTurn | undefined {
  if (!current || current.response) {
    return current;
  }

  return {
    ...current,
    response: fallback,
  };
}

export function extractCliThinkingText(chunk: AIMessageChunk): string | undefined {
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

export function extractCliStreamingTokenCounts(chunk: AIMessageChunk): StreamingTokenCounts | undefined {
  const usageMeta = chunk.usage_metadata as Record<string, unknown> | undefined;
  if (!usageMeta) {
    return undefined;
  }

  const input = typeof usageMeta.input_tokens === 'number' ? usageMeta.input_tokens : 0;
  const output = typeof usageMeta.output_tokens === 'number' ? usageMeta.output_tokens : 0;
  if (input <= 0 && output <= 0) {
    return undefined;
  }

  return {input, output};
}

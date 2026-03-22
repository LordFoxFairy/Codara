import {AIMessageChunk} from '@langchain/core/messages';
import type {CliActiveTurn} from './view-state';

const INTERNAL_INTERACTION_TOOL_NAMES = new Set(['AskUserQuestion', 'Skill']);

export interface ApplyInteractionChunkOptions {
  captureThinking?: boolean;
  detectAgentLaunch?: boolean;
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

  if (options.detectAgentLaunch && Array.isArray(chunk.tool_calls) && chunk.tool_calls.some((toolCall) => toolCall?.name === 'Agent')) {
    next = {...next, pendingAgentLaunch: true};
  }

  if (containsInternalInteractionToolCall(chunk)) {
    next = {
      ...next,
      responseBeforeRuntime: undefined,
      response: '',
      suppressInteractionResponse: true,
    };
  }

  const text = chunk.text;
  if (!text || next.suppressInteractionResponse) {
    return {turn: next, sawText: false};
  }

  return {
    turn: {
      ...next,
      ...(next.kind === 'prompt' && next.responseRole === 'assistant'
        ? {pendingResponse: (next.pendingResponse ?? '') + text}
        : {response: next.response + text}),
    },
    sawText: next.kind !== 'prompt' || next.responseRole !== 'assistant',
  };
}

function containsInternalInteractionToolCall(chunk: AIMessageChunk): boolean {
  if (!Array.isArray(chunk.tool_calls) || chunk.tool_calls.length === 0) {
    return false;
  }

  return chunk.tool_calls.some((toolCall) => {
    const name = typeof toolCall?.name === 'string' ? toolCall.name.trim() : '';
    return INTERNAL_INTERACTION_TOOL_NAMES.has(name);
  });
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

export function sealActiveTurnAtRuntimeBoundary(
  turn: CliActiveTurn | undefined,
): CliActiveTurn | undefined {
  if (!turn || turn.responseBeforeRuntime) {
    return turn;
  }

  const buffered = turn.pendingResponse?.trim() ? turn.pendingResponse : undefined;
  const currentResponse = turn.response.trim() ? turn.response : undefined;
  const preRuntimeResponse = buffered ?? currentResponse;
  if (!preRuntimeResponse) {
    return turn;
  }

  return {
    ...turn,
    pendingResponse: undefined,
    responseBeforeRuntime: preRuntimeResponse,
    response: '',
  };
}

export function finalizeBufferedInteractionText(
  turn: CliActiveTurn | undefined,
): CliActiveTurn | undefined {
  if (!turn || turn.suppressInteractionResponse || !turn.pendingResponse?.trim()) {
    return turn;
  }

  return {
    ...turn,
    pendingResponse: undefined,
    response: turn.response + turn.pendingResponse,
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

import type {BaseMessage} from '@langchain/core/messages';

export interface TokenEstimateInput {
  systemMessage: string[];
  messages: BaseMessage[];
}

export type TokenEstimator = (input: TokenEstimateInput) => number;

/**
 * Estimate the total input tokens for a model call.
 * Uses simple heuristic-based estimation (no tokenizer).
 */
export function estimateModelInputTokens(input: TokenEstimateInput): number {
  const systemTokens = input.systemMessage.reduce((total, content) => total + estimateTextTokens(content) + 4, 0);
  const messageTokens = input.messages.reduce((total, message) => total + estimateTextTokens(serializeMessageContent(message)) + 6, 0);
  return systemTokens + messageTokens;
}

/**
 * CJK character range regex — matches CJK unified ideographs and common symbols.
 * CJK characters are typically 1-2 tokens/char, ASCII ~0.25 tokens/char.
 */
const CJK_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]/g;

function estimateTextTokens(text: string): number {
  const cjkCount = (text.match(CJK_REGEX) ?? []).length;
  const asciiLength = text.length - cjkCount;
  // ASCII: ~4 chars/token; CJK: ~1.5 chars/token
  return Math.max(1, Math.ceil(asciiLength / 4 + cjkCount * 1.5));
}

function serializeMessageContent(message: BaseMessage): string {
  const parts: string[] = [];
  const text = message.text.trim();

  if (text) {
    parts.push(text);
  }

  if ('tool_calls' in message && Array.isArray((message as {tool_calls?: unknown[]}).tool_calls)) {
    parts.push(JSON.stringify((message as {tool_calls?: unknown[]}).tool_calls));
  }

  if ('additional_kwargs' in message && (message as {additional_kwargs?: unknown}).additional_kwargs) {
    parts.push(JSON.stringify((message as {additional_kwargs?: unknown}).additional_kwargs));
  }

  return parts.join('\n');
}

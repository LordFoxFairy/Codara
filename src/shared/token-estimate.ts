/**
 * Heuristic token estimation — no tokenizer dependency.
 *
 * Used by budget middleware to decide when to compact without
 * incurring the cost of a real tokenizer call.
 */

import type {BaseMessage} from '@langchain/core/messages';

export interface TokenEstimateInput {
  systemMessage: string[];
  messages: BaseMessage[];
}

export type TokenEstimator = (input: TokenEstimateInput) => number;

/** Estimate the total input tokens for a model call. */
export function estimateModelInputTokens(input: TokenEstimateInput): number {
  // +4 per system block for role/separator overhead; +6 per message for the same
  const systemTokens = input.systemMessage.reduce((sum, text) => sum + estimateTextTokens(text) + 4, 0);
  const messageTokens = input.messages.reduce((sum, msg) => sum + estimateTextTokens(serializeMessage(msg)) + 6, 0);
  return systemTokens + messageTokens;
}

// ── Private ──

/**
 * CJK characters are typically 1-2 tokens each, ASCII ~4 chars per token.
 * This regex matches CJK unified ideographs and common CJK symbols.
 */
const CJK_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]/g;

function estimateTextTokens(text: string): number {
  const cjkCount = (text.match(CJK_REGEX) ?? []).length;
  const asciiLength = text.length - cjkCount;
  return Math.max(1, Math.ceil(asciiLength / 4 + cjkCount * 1.5));
}

/** Flatten a message into a single string for token counting. */
function serializeMessage(message: BaseMessage): string {
  const parts: string[] = [];

  const text = message.text.trim();
  if (text) parts.push(text);

  const msg = message as unknown as Record<string, unknown>;
  if (Array.isArray(msg.tool_calls)) parts.push(JSON.stringify(msg.tool_calls));
  if (msg.additional_kwargs) parts.push(JSON.stringify(msg.additional_kwargs));

  return parts.join('\n');
}

/**
 * Message text extraction helpers for LangChain BaseMessage arrays.
 *
 * These are the canonical way to read human-visible text from agent messages.
 * Internal runtime payloads (e.g. review_pause JSON) are filtered out so
 * they never leak into user-facing displays.
 */

import {AIMessage, type BaseMessage} from '@langchain/core/messages';

/** Extract the trimmed text of a single message, or undefined if empty. */
export function readMessageText(message: BaseMessage | undefined): string | undefined {
  const text = message?.text.trim();
  return text || undefined;
}

/**
 * Extract visible text — same as readMessageText but filters out
 * internal runtime payloads (review_pause) that should not be shown to users.
 */
export function readVisibleMessageText(message: BaseMessage | undefined): string | undefined {
  const text = readMessageText(message);
  if (!text) return undefined;
  return isHiddenRuntimePayload(text) ? undefined : text;
}

/**
 * Find the last AI (assistant) message's visible text in a message array.
 * Skips tool messages, human messages, and hidden runtime payloads.
 */
export function readLatestAssistantText(messages: readonly BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(messages[i])) {
      const text = readVisibleMessageText(messages[i]);
      if (text) return text;
    }
  }
}

/**
 * Find the last visible text from any message type in a message array.
 * Useful when you want to show the most recent output regardless of sender.
 */
export function readLatestVisibleMessageText(messages: readonly BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = readVisibleMessageText(messages[i]);
    if (text) return text;
  }
}

// ── Private ──

/**
 * Detect internal runtime payloads embedded as JSON text.
 * These are injected by the review middleware and should never be shown to users.
 */
function isHiddenRuntimePayload(text: string): boolean {
  if (!text.startsWith('{') || !text.includes('"type"')) return false;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).type === 'review_pause';
  } catch {
    return false;
  }
}

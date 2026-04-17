/**
 * Bus event classification — pure functions that turn stream chunks into
 * BusEvents. Kept separate from the CodaraBus class so the bus file stays
 * focused on lifecycle, client management and request routing.
 */

import {AIMessageChunk} from '@langchain/core/messages';
import type {AgentStreamOutput, AgentStreamCustomChunk} from '@core/agent';
import type {BusEvent} from './types';

// ── Public API ────────────────────────────────────────────────────────────

export type BusEventEmitter = (event: BusEvent) => void;

/**
 * Classify a single stream chunk and emit the appropriate BusEvent(s).
 *
 * Classification order:
 *   1. Tagged tuple — unwrap and recurse
 *   2. AIMessageChunk — thinking / text / tool_call tokens
 *   3. Custom chunk — review_event / tool_progress (ignored here)
 *   4. Tool result — tool name + truncated output
 *   5. Anything else — skip (full model response, batch messages)
 */
export function classifyAndEmit(
  emit: BusEventEmitter,
  sessionId: string,
  chunk: AgentStreamOutput,
): void {
  // 1. Tagged tuple [mode, payload] — unwrap and recurse.
  if (Array.isArray(chunk) && chunk.length === 2 && typeof chunk[0] === 'string') {
    classifyAndEmit(emit, sessionId, chunk[1] as AgentStreamOutput);
    return;
  }

  // 2. AIMessageChunk — incremental text / thinking / tool_call tokens.
  if (AIMessageChunk.isInstance(chunk)) {
    emitAIChunkEvents(emit, sessionId, chunk as AIMessageChunk);
    return;
  }

  // 3. Custom chunk — review / progress events are handled by pipeStream result.
  if (isCustomChunk(chunk)) return;

  // 4. Tool result messages.
  if (isToolResult(chunk)) {
    emitToolResultEvent(emit, sessionId, chunk);
    return;
  }

  // 5. Full model response / batch — skip (already streamed incrementally).
}

// ── Private helpers ───────────────────────────────────────────────────────

/** Emit thinking, token, and tool_call events from an AIMessageChunk. */
function emitAIChunkEvents(emit: BusEventEmitter, sessionId: string, aiChunk: AIMessageChunk): void {
  // Thinking blocks.
  if (Array.isArray(aiChunk.content)) {
    for (const block of aiChunk.content) {
      if (isThinkingBlock(block)) {
        emit({type: 'thinking', sessionId, text: block.thinking});
      }
    }
  }

  // Text token.
  const text = typeof aiChunk.text === 'string' ? aiChunk.text : '';
  if (text) {
    emit({type: 'token', sessionId, text});
  }

  // Tool call chunks.
  if (aiChunk.tool_call_chunks && aiChunk.tool_call_chunks.length > 0) {
    for (const tc of aiChunk.tool_call_chunks) {
      if (tc.name) {
        emit({
          type: 'tool_call',
          sessionId,
          name: tc.name,
          args: {argsFragment: tc.args ?? '', id: tc.id, index: tc.index},
        });
      }
    }
  }
}

/** Emit a tool_result event, truncating output to 4000 chars. */
function emitToolResultEvent(emit: BusEventEmitter, sessionId: string, chunk: ToolResultChunk): void {
  const toolMsg = chunk.tools.messages[0];
  emit({
    type: 'tool_result',
    sessionId,
    name: toolMsg.name ?? 'unknown',
    output: typeof toolMsg.content === 'string'
      ? toolMsg.content.slice(0, 4000)
      : String(toolMsg.content).slice(0, 4000),
  });
}

// ── Type Guards ───────────────────────────────────────────────────────────

/** A tool result chunk from the stream. */
type ToolResultChunk = {tools: {messages: [{name?: string; content: unknown; status?: string; tool_call_id?: string}]}};

function isThinkingBlock(block: unknown): block is {type: 'thinking'; thinking: string} {
  return (
    block !== null &&
    typeof block === 'object' &&
    'type' in block &&
    (block as Record<string, unknown>).type === 'thinking' &&
    'thinking' in block &&
    typeof (block as Record<string, unknown>).thinking === 'string' &&
    !!(block as Record<string, unknown>).thinking
  );
}

function isCustomChunk(chunk: unknown): chunk is AgentStreamCustomChunk {
  if (chunk === null || typeof chunk !== 'object' || !('type' in chunk)) {
    return false;
  }
  const type = (chunk as Record<string, unknown>).type;
  return type === 'review_event' || type === 'tool_progress';
}

function isToolResult(chunk: unknown): chunk is ToolResultChunk {
  return (
    chunk !== null &&
    typeof chunk === 'object' &&
    'tools' in chunk &&
    typeof (chunk as Record<string, unknown>).tools === 'object'
  );
}

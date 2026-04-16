import type {ToolCall} from '@langchain/core/messages';

/**
 * Resolve a stable tool-call ID from a ToolCall object.
 *
 * Returns the existing `id` when present, otherwise generates a deterministic
 * fallback like `bash_0` or `read_file_2`.
 *
 * Single source of truth — both the core executor and review middleware
 * must use this to avoid ID mismatches.
 */
export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  return id || `${toolCall.name?.trim() || 'tool'}_${toolIndex}`;
}

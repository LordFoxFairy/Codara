import type {ToolCall} from '@langchain/core/messages';

/**
 * Resolve a stable tool-call ID from a ToolCall object.
 *
 * If the ToolCall already carries a non-empty `id`, that value is returned as-is.
 * Otherwise a deterministic fallback is generated from the tool name and index,
 * e.g. `bash_0`, `read_file_2`.
 *
 * This is the single source of truth — both the core executor and review middleware
 * must use this to avoid ID mismatches.
 */
export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  return id || `${toolCall.name?.trim() || 'tool'}_${toolIndex}`;
}

import type {ToolCall} from '@langchain/core/messages';
import type {AgentFinishReason, AgentResult, AgentState} from '@core/agents/types';

/** 为缺失 id 的 tool_call 生成稳定 fallback。 */
export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const existingId = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  if (existingId) {
    return existingId;
  }

  const safeToolName = toolCall.name?.trim() || 'tool';
  return `${safeToolName}_${toolIndex}`;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 统一构造 AgentResult，避免散落字面量与重复错误归一化。 */
export function createAgentResult(
  state: AgentState,
  turns: number,
  reason: AgentFinishReason,
  error?: unknown
): AgentResult {
  return {
    reason,
    state,
    turns,
    error: error === undefined ? undefined : toError(error)
  };
}

import type {ToolMessage} from '@langchain/core/messages';
import type {ToolCallContext} from '@core/pipeline/types';
import {readExecutionMetadata, type BaseExecutionContext} from '@core/pipeline/types';
import {readDelegatedAgentResult} from '@shared/delegation-result';
import {readTaskRunLaunchResult} from '@shared/task-run-launch';
import {TOOL_NAMES, formatToolSummary, readString} from '@shared/tool-display';

export function turnKey(context: BaseExecutionContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}`;
}

export function toolKey(context: ToolCallContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}:${execution.toolCallId ?? context.toolCall.id ?? context.toolIndex}`;
}

export function formatToolLabel(context: ToolCallContext): string {
  const name = context.toolCall.name ?? 'tool';
  const summary = formatToolSummary(name, context.toolCall.args);
  return summary ? `${formatToolDisplayName(name)}(${summary})` : formatToolDisplayName(name);
}

export function formatToolDisplayName(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.BASH:
      return 'Running Bash';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return 'Reading';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
      return 'Writing';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return 'Editing';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return 'Fetching';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return 'Searching';
    case TOOL_NAMES.TASK:
      return 'Delegating task';
    case TOOL_NAMES.TASK_CREATE:
      return 'Creating task';
    case TOOL_NAMES.TASK_UPDATE:
      return 'Updating task';
    case TOOL_NAMES.TASK_LIST:
      return 'Listing tasks';
    case TOOL_NAMES.ASK_USER:
      return 'AskUserQuestion';
    default:
      return toolName;
  }
}

export function summarizeToolMessage(message: ToolMessage): string | undefined {
  if (typeof message.content !== 'string') {
    return undefined;
  }

  const trimmed = message.content.trim();
  return trimmed || undefined;
}

export function summarizeDelegatedTask(message: ToolMessage): string | undefined {
  const launched = readTaskRunLaunchResult(message.artifact);
  if (launched) {
    return `run_id: ${launched.runId}\ndelegate_id: ${launched.sessionId}`;
  }

  const delegated = readDelegatedAgentResult(message.artifact);
  if (!delegated) {
    return summarizeToolMessage(message);
  }

  const parts: string[] = [];
  if (delegated.summary?.trim()) {
    parts.push(delegated.summary.trim());
  }
  const statParts: string[] = [];
  if (delegated.toolUseCount && delegated.toolUseCount > 0) {
    statParts.push(`${delegated.toolUseCount} tool uses`);
  }
  if (delegated.totalTokens && delegated.totalTokens > 0) {
    statParts.push(`${formatDelegatedTokens(delegated.totalTokens)} tokens`);
  }
  if (statParts.length > 0) {
    parts.push(statParts.join(' · '));
  }
  return parts.join('\n') || summarizeToolMessage(message);
}

export function formatDelegatedTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatTaskStartLabel(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return 'Delegating task';
  }

  const record = args as Record<string, unknown>;
  const subagentType = readString(record.subagent_type);
  const prompt = readString(record.prompt);
  if (subagentType && prompt) {
    return `Delegating ${subagentType}: ${prompt}`;
  }
  if (subagentType) {
    return `Delegating ${subagentType}`;
  }
  if (prompt) {
    return `Delegating task: ${prompt}`;
  }
  return 'Delegating task';
}

export function summarizePauseLabel(description: string): string {
  const trimmed = description.trim();
  return trimmed || 'Waiting for review';
}

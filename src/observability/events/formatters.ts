/**
 * Event formatting utilities for the runtime events controller.
 *
 * Provides key derivation (turnKey, toolKey) for parent-child event linking,
 * tool label formatting for display, and subagent summary helpers.
 */
import type {ToolMessage} from '@langchain/core/messages';
import type {ToolCallContext} from '@core/pipeline/types';
import {readExecutionMetadata, type BaseExecutionContext} from '@core/pipeline/types';
import {readSubagentResult} from '@shared/subagent-result';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {TOOL_NAMES, formatToolSummary, readString} from '@shared/tool-display';
import {formatSubagentDisplayName, normalizeSubagentType} from '@capability/skill';

/** Derive a unique key for a turn within a run (used for parent-child event linking). */
export function turnKey(context: BaseExecutionContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}`;
}

/** Derive a unique key for a tool call within a turn. */
export function toolKey(context: ToolCallContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}:${execution.toolCallId ?? context.toolCall.id ?? context.toolIndex}`;
}

/** Build a human-readable label for a tool call (e.g. "Running Bash(ls -la)"). */
export function formatToolLabel(context: ToolCallContext): string {
  const name = context.toolCall.name ?? 'tool';
  const summary = formatToolSummary(name, context.toolCall.args);
  return summary ? `${formatToolDisplayName(name)}(${summary})` : formatToolDisplayName(name);
}

/** Map a raw tool name to a friendly display verb (e.g. "Bash" → "Running Bash"). */
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
    case TOOL_NAMES.AGENT:
      return 'Delegating subagent';
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

/** Extract a trimmed string summary from a tool result message (or undefined if empty). */
export function summarizeToolMessage(message: ToolMessage): string | undefined {
  if (typeof message.content !== 'string') {
    return undefined;
  }

  const trimmed = message.content.trim();
  return trimmed || undefined;
}

/** Summarize a subagent tool result, including tool-use count and token stats. */
export function summarizeSubagent(message: ToolMessage): string | undefined {
  const launched = readSubagentRunLaunchResult(message.artifact);
  if (launched) {
    return undefined;
  }

  const subagent = readSubagentResult(message.artifact);
  if (!subagent) {
    return summarizeToolMessage(message);
  }

  const parts: string[] = [];
  if (subagent.summary?.trim()) {
    parts.push(subagent.summary.trim());
  }
  const statParts: string[] = [];
  if (subagent.toolUseCount && subagent.toolUseCount > 0) {
    statParts.push(`${subagent.toolUseCount} tool uses`);
  }
  if (subagent.totalTokens && subagent.totalTokens > 0) {
    statParts.push(`${formatSubagentTokens(subagent.totalTokens)} tokens`);
  }
  if (statParts.length > 0) {
    parts.push(statParts.join(' · '));
  }
  return parts.join('\n') || summarizeToolMessage(message);
}

/** Format a token count with human-readable units (e.g. 1500 → "1.5k"). */
export function formatSubagentTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Build a label for an agent delegation event (e.g. "Delegating Explore: find config files"). */
export function formatAgentStartLabel(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return 'Delegating Agent';
  }

  const record = args as Record<string, unknown>;
  const subagentType = normalizeSubagentType(readString(record.subagent_type));
  const prompt = readString(record.prompt);
  if (subagentType && prompt) {
    return `Delegating ${formatSubagentDisplayName(subagentType)}: ${prompt}`;
  }
  if (subagentType) {
    return `Delegating ${formatSubagentDisplayName(subagentType)}`;
  }
  if (prompt) {
    return `Delegating Agent: ${prompt}`;
  }
  return 'Delegating Agent';
}

/** Build a label for a review-pause event (falls back to "Waiting for review"). */
export function summarizePauseLabel(description: string): string {
  const trimmed = description.trim();
  return trimmed || 'Waiting for review';
}

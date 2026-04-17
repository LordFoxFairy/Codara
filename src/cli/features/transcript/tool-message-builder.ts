/**
 * Builds TranscriptItem[] from LangChain ToolMessage instances.
 *
 * Extracted from tool-formatter.ts to separate the core-message concern
 * (LangChain messages → transcript items) from the runtime-event concern
 * (CodaraRuntimeEvent → transcript items).
 */
import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {
  parseAskUserResult,
  parseReviewToolMessagePayload,
  formatSubagentDisplayName,
  normalizeSubagentType,
} from '@/index';
import {readMessageText} from '@shared/messages';
import {readSubagentResult} from '@shared/subagent-result';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {readSharedTaskCoordinationArtifact} from '@shared/task-coordination-result';
import {TOOL_NAMES, formatToolDisplayName, formatToolHeaderArgs} from '@shared/tool-display';
import {formatTokenCount} from '../../utils/format';
import {computeEditDiff, type DiffData} from './diff-compute';
import type {ToolResultMeta, TranscriptItem, TranscriptRole} from './model';
import {
  TODO_TOOL_NAME,
  isAgentToolName,
  isInteractionToolName,
  isHiddenTranscriptToolName,
  isRepeatedAskUserContinuationNotice,
  parseAgentRuntimeLabel,
  buildAgentCoverageKey,
} from './tool-formatter';

// ── Primitive helpers (private) ──────────────────────────────────

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function limitSummary(value: string | undefined, maxLength = 72): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

// ── Tool output formatting (private) ─────────────────────────────

const TOOL_META_MAX_LINES = 4;

function toolIcon(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL: return '\u2699';
    case TOOL_NAMES.BASH: return '\u26A1';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ: return '\u2192';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE: return '\u2190';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT: return '\u25CF';
    case TOOL_NAMES.GLOB:
    case TOOL_NAMES.GREP: return '\u2731';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH: return '%';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH: return '\u25C8';
    case TOOL_NAMES.TASK_CREATE:
    case TOOL_NAMES.TASK_UPDATE:
    case TOOL_NAMES.TASK_LIST: return '\u2502';
    default: return '\u2699';
  }
}

function truncateOutput(detail?: string, maxLines: number = TOOL_META_MAX_LINES): {visible: string[]; all: string[]; total: number} {
  if (!detail?.trim()) return {visible: [], all: [], total: 0};
  const allLines = detail.trim().split('\n');
  return {visible: allLines.slice(0, maxLines), all: allLines, total: allLines.length};
}

function buildEditSummary(detail: string): string {
  const lines = detail.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  if (added === 0 && removed === 0) return 'Edited';
  const parts: string[] = [];
  if (added > 0) parts.push(`Added ${added} line${added === 1 ? '' : 's'}`);
  if (removed > 0) parts.push(`removed ${removed} line${removed === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function buildToolOutput(
  toolName: string,
  status: 'done' | 'error',
  detail?: string,
): {summaryLine: string; outputLines?: string[]; allOutputLines?: string[]; totalOutputLines?: number} {
  if (status === 'error') {
    const lines = truncateOutput(detail);
    return {summaryLine: 'Error', outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
  }

  const trimmed = detail?.trim() ?? '';
  switch (toolName) {
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE: {
      const lines = truncateOutput(trimmed);
      const fileMatch = trimmed.match(/^Wrote \d+ lines? to (.+)/);
      const summaryLine = fileMatch
        ? `Wrote ${lines.total} lines to ${fileMatch[1]}`
        : `Wrote ${lines.total} lines`;
      return {summaryLine, outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT: {
      const lines = truncateOutput(trimmed);
      return {summaryLine: buildEditSummary(trimmed), outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.BASH: {
      if (!trimmed) return {summaryLine: 'Done'};
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
    case TOOL_NAMES.AGENT: {
      if (!trimmed) return {summaryLine: 'Done'};
      const taskLines = trimmed.split('\n');
      return {summaryLine: taskLines[0] ?? 'Done', outputLines: taskLines.slice(1), allOutputLines: taskLines.slice(1), totalOutputLines: taskLines.length};
    }
    default: {
      if (!trimmed) return {summaryLine: 'Done'};
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
  }
}

function formatFriendlyToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  switch (toolName) {
    case TOOL_NAMES.SKILL: return limitSummary(asString(record.skill));
    case TOOL_NAMES.BASH: return limitSummary(asString(record.command) || asString(record.description));
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ: {
      const filePath = asString(record.file_path) || asString(record.path);
      if (!filePath) return undefined;
      const offset = typeof record.offset === 'number' ? record.offset : undefined;
      const limit = typeof record.limit === 'number' ? record.limit : undefined;
      const range = offset !== undefined || limit !== undefined
        ? `:${offset ?? 0}${limit !== undefined ? `+${limit}` : ''}`
        : '';
      return limitSummary(`${filePath}${range}`);
    }
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH: {
      const url = asString(record.url);
      if (!url) return undefined;
      const method = (asString(record.method) || 'GET').toUpperCase();
      return limitSummary(method === 'GET' ? url : `${method} ${url}`);
    }
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH: return limitSummary(asString(record.query));
    case TOOL_NAMES.GLOB: return limitSummary(asString(record.pattern) || asString(record.path));
    case TOOL_NAMES.GREP: {
      const pattern = asString(record.pattern);
      const targetPath = asString(record.path);
      if (pattern && targetPath) return limitSummary(`${pattern} @ ${targetPath}`);
      return limitSummary(pattern || targetPath);
    }
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT: return limitSummary(asString(record.file_path) || asString(record.path));
    default: return undefined;
  }
}

function tryComputeDiff(toolName: string, toolArgs: unknown): DiffData | undefined {
  try {
    if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) return undefined;
    const record = toolArgs as Record<string, unknown>;
    const filePath = asString(record.file_path) || asString(record.path);
    if (!filePath) return undefined;
    switch (toolName) {
      case TOOL_NAMES.EDIT:
      case TOOL_NAMES.EDIT_FILE: {
        const oldString = asString(record.old_string);
        const newString = asString(record.new_string);
        return oldString !== undefined && newString !== undefined
          ? computeEditDiff(filePath, oldString, newString)
          : undefined;
      }
      case TOOL_NAMES.WRITE:
      case TOOL_NAMES.WRITE_FILE: {
        const content = asString(record.content);
        return content !== undefined
          ? {filePath, hunks: [], additions: content.split('\n').length, deletions: 0, isNewFile: true}
          : undefined;
      }
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

// ── Helpers for agent/task tool results ──────────────────────────

function readTaskToolArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatTaskToolAgentName(toolCall: ToolCall | undefined): string {
  const subagentType = normalizeSubagentType(readTaskToolArg(toolCall?.args, 'subagent_type'));
  return subagentType ? formatSubagentDisplayName(subagentType) : 'Agent';
}

function readTaskToolPrompt(toolCall: ToolCall | undefined): string | undefined {
  return readTaskToolArg(toolCall?.args, 'prompt');
}

// ── Public: message visibility predicates ────────────────────────

export function shouldHideInternalToolMessage(message: ToolMessage): boolean {
  const artifact = message.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return false;
  const record = artifact as Record<string, unknown>;
  return record.type === 'ask_user_internal' && record.visibility === 'hidden';
}

export function resolveToolMessageName(message: ToolMessage, toolLookup: Map<string, ToolCall>): string | undefined {
  const explicitName = typeof message.name === 'string' ? message.name.trim() : '';
  if (explicitName) return explicitName;
  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  return toolCallId ? toolLookup.get(toolCallId)?.name : undefined;
}

// ── Public: build TranscriptItem[] from a ToolMessage ────────────

export function buildToolResultItems(
  message: ToolMessage,
  messageId: string,
  index: number,
  allMessages: readonly import('@langchain/core/messages').BaseMessage[],
  toolLookup: Map<string, ToolCall>,
): TranscriptItem[] {
  if (shouldHideInternalToolMessage(message)) return [];

  const reviewPayload = parseReviewToolMessagePayload(message.content);
  if (reviewPayload?.type === 'review_pause') return [];
  if (reviewPayload?.type === 'review_deny') {
    return [{id: messageId, role: 'error', content: reviewPayload.reason}];
  }

  const text = readMessageText(message);
  if (!text) return [];
  if (isRepeatedAskUserContinuationNotice(text)) return [];

  const resolvedName = resolveToolMessageName(message, toolLookup);
  if (isHiddenTranscriptToolName(resolvedName)) return [];
  if (isInteractionToolName(resolvedName) || parseAskUserResult(text)) return [];
  if (readSharedTaskCoordinationArtifact(message.artifact)) return [];
  if (resolvedName === TODO_TOOL_NAME) return [];

  if (resolvedName === TOOL_NAMES.AGENT) {
    const taskMeta = buildTaskToolMeta(message, index, allMessages, toolLookup);
    if (!taskMeta) return [];
    return [{
      id: messageId,
      role: 'agent',
      content: `${taskMeta.icon} ${taskMeta.displayName}(${taskMeta.args ?? ''})\n${taskMeta.summaryLine}`,
      toolMeta: taskMeta,
    }];
  }

  const formattedContent = text;
  const lineCount = formattedContent.split('\n').length;
  const toolMeta = resolvedName && !isAgentToolName(resolvedName)
    ? buildToolMeta(resolvedName, message, toolLookup, text)
    : undefined;

  return [{
    id: messageId,
    role: 'tool' as TranscriptRole,
    content: toolMeta
      ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
      : formattedContent,
    renderHint: lineCount > 3 ? 'block' : 'inline',
    toolMeta,
  }];
}

// ── Private: build ToolResultMeta from a standard tool message ───

function buildToolMeta(
  rawToolName: string,
  message: ToolMessage,
  toolLookup: Map<string, ToolCall>,
  text: string,
): ToolResultMeta {
  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  const toolCall = toolCallId ? toolLookup.get(toolCallId) : undefined;
  const args = toolCall ? formatFriendlyToolSummary(rawToolName, toolCall.args) : undefined;
  const status = message.status === 'error' ? 'error' : 'done';
  const output = buildToolOutput(rawToolName, status as 'done' | 'error', text);
  const diffData = toolCall ? tryComputeDiff(rawToolName, toolCall.args) : undefined;
  return {toolName: rawToolName, displayName, icon, args, status: status as 'done' | 'error', ...output, diffData};
}

// ── Private: build ToolResultMeta from an Agent/Task tool message ─

function buildTaskToolMeta(
  message: ToolMessage,
  index: number,
  allMessages: readonly import('@langchain/core/messages').BaseMessage[],
  toolLookup: Map<string, ToolCall>,
): ToolResultMeta | undefined {
  const launched = readSubagentRunLaunchResult(message.artifact);
  if (launched) {
    if (hasCompletedSubagentResultForToolCall(message, index, allMessages)) return undefined;
    const parsed = parseAgentRuntimeLabel(launched.label);
    return {
      toolName: TOOL_NAMES.AGENT,
      displayName: parsed.displayName,
      icon: '\u23FA',
      args: parsed.args,
      runId: launched.runId,
      coverageKey: buildAgentCoverageKey(parsed.displayName, parsed.args, 'running'),
      status: 'running',
      summaryLine: 'Running',
    };
  }

  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  const toolCall = toolCallId ? toolLookup.get(toolCallId) : undefined;
  const delegated = readSubagentResult(message.artifact);
  const displayName = delegated?.label
    ? parseAgentRuntimeLabel(delegated.label).displayName
    : formatTaskToolAgentName(toolCall);
  const rawArgs = delegated?.label
    ? parseAgentRuntimeLabel(delegated.label).args
    : readTaskToolPrompt(toolCall);
  const args = rawArgs ? formatToolHeaderArgs(TOOL_NAMES.AGENT, rawArgs) : undefined;

  if (delegated) {
    const parts: string[] = [];
    if (typeof delegated.toolUseCount === 'number' && delegated.toolUseCount > 0) {
      parts.push(`${delegated.toolUseCount} tool uses`);
    }
    if (typeof delegated.totalTokens === 'number' && delegated.totalTokens > 0) {
      parts.push(`${formatTokenCount(delegated.totalTokens)} tokens`);
    }
    const summaryLine = delegated.reason === 'error'
      ? parts.length > 0 ? `Failed (${parts.join(' \u00B7 ')})` : 'Failed'
      : parts.length > 0 ? `Done (${parts.join(' \u00B7 ')})` : 'Done';
    return {
      toolName: TOOL_NAMES.AGENT,
      displayName,
      icon: '\u23FA',
      args,
      ...(delegated.runId || toolCallId ? {runId: delegated.runId ?? toolCallId} : {}),
      coverageKey: buildAgentCoverageKey(displayName, rawArgs, delegated.reason === 'error' ? 'error' : 'done'),
      status: delegated.reason === 'error' ? 'error' : 'done',
      summaryLine,
    };
  }

  const fallbackText = readMessageText(message)?.trim();
  if (!fallbackText) return undefined;

  return {
    toolName: TOOL_NAMES.AGENT,
    displayName,
    icon: '\u23FA',
    args,
    ...(toolCallId ? {runId: toolCallId} : {}),
    coverageKey: buildAgentCoverageKey(displayName, rawArgs, message.status === 'error' ? 'error' : 'done'),
    status: message.status === 'error' ? 'error' : 'done',
    summaryLine: message.status === 'error' ? 'Failed' : 'Done',
  };
}

function hasCompletedSubagentResultForToolCall(
  message: ToolMessage,
  index: number,
  allMessages: readonly import('@langchain/core/messages').BaseMessage[],
): boolean {
  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  if (!toolCallId) return false;

  for (let cursor = index + 1; cursor < allMessages.length; cursor += 1) {
    const candidate = allMessages[cursor];
    if (!candidate || !ToolMessage.isInstance(candidate)) continue;
    const candidateToolCallId = typeof candidate.tool_call_id === 'string' ? candidate.tool_call_id.trim() : '';
    if (candidateToolCallId !== toolCallId) continue;
    if (readSubagentResult(candidate.artifact)) return true;
  }
  return false;
}

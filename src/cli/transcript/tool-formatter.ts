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
import {formatTokenCount} from '../utils/format';
import {computeEditDiff, type DiffData} from './diff-compute';
import type {ToolResultMeta, TranscriptItem, TranscriptRole} from './model';
import type {CodaraRuntimeEvent} from '@/index';

// ── Shared constants ──────────────────────────────────────────────

export const TODO_TOOL_NAME = 'write_todos';
export const TOOL_META_MAX_LINES = 4;

// ── Tool name predicates ──────────────────────────────────────────

export function isAgentToolName(toolName: string | undefined): boolean {
  return toolName === TOOL_NAMES.AGENT
    || toolName === TOOL_NAMES.TASK_CREATE
    || toolName === TOOL_NAMES.TASK_UPDATE
    || toolName === TOOL_NAMES.TASK_LIST;
}

export function isInteractionToolName(toolName: string | undefined): boolean {
  return (toolName || '').trim() === TOOL_NAMES.ASK_USER;
}

export function isHiddenTranscriptToolName(toolName: string | undefined): boolean {
  return (toolName || '').trim() === TOOL_NAMES.SKILL;
}

export function isRepeatedAskUserContinuationNotice(detail: unknown): boolean {
  return typeof detail === 'string' && detail.includes('AskUserQuestion was just answered in this flow.');
}

// ── Tool icon / display ───────────────────────────────────────────

export function toolIcon(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return '\u2699';
    case TOOL_NAMES.BASH:
      return '\u26A1';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return '\u2192';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
      return '\u2190';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return '\u25CF';
    case TOOL_NAMES.GLOB:
    case TOOL_NAMES.GREP:
      return '\u2731';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return '%';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return '\u25C8';
    case TOOL_NAMES.TASK_CREATE:
    case TOOL_NAMES.TASK_UPDATE:
    case TOOL_NAMES.TASK_LIST:
      return '\u2502';
    default:
      return '\u2699';
  }
}

// ── Primitive helpers ─────────────────────────────────────────────

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function limitSummary(value: string | undefined, maxLength = 72): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function serializeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── Tool arg formatting ───────────────────────────────────────────

export function formatFriendlyToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return serializeValue(args);
  }

  const record = args as Record<string, unknown>;
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return limitSummary(asString(record.skill));
    case TOOL_NAMES.BASH:
      return limitSummary(asString(record.command) || asString(record.description));
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return formatReadSummary(record);
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return formatFetchSummary(record);
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return limitSummary(asString(record.query));
    case TOOL_NAMES.GLOB:
      return limitSummary(asString(record.pattern) || asString(record.path));
    case TOOL_NAMES.GREP:
      return formatGrepSummary(record);
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return limitSummary(asString(record.file_path) || asString(record.path));
    default:
      return undefined;
  }
}

function formatReadSummary(record: Record<string, unknown>): string | undefined {
  const filePath = asString(record.file_path) || asString(record.path);
  if (!filePath) {
    return undefined;
  }

  const offset = typeof record.offset === 'number' ? record.offset : undefined;
  const limit = typeof record.limit === 'number' ? record.limit : undefined;
  const range = offset !== undefined || limit !== undefined
    ? `:${offset ?? 0}${limit !== undefined ? `+${limit}` : ''}`
    : '';
  return limitSummary(`${filePath}${range}`);
}

function formatFetchSummary(record: Record<string, unknown>): string | undefined {
  const url = asString(record.url);
  if (!url) {
    return undefined;
  }

  const method = (asString(record.method) || 'GET').toUpperCase();
  return limitSummary(method === 'GET' ? url : `${method} ${url}`);
}

function formatGrepSummary(record: Record<string, unknown>): string | undefined {
  const pattern = asString(record.pattern);
  const targetPath = asString(record.path);
  if (pattern && targetPath) {
    return limitSummary(`${pattern} @ ${targetPath}`);
  }
  return limitSummary(pattern || targetPath);
}

// ── Tool output building ──────────────────────────────────────────

export function buildToolOutput(
  toolName: string,
  status: 'done' | 'error',
  detail?: string,
): {summaryLine: string; outputLines?: string[]; allOutputLines?: string[]; totalOutputLines?: number} {
  if (status === 'error') {
    const lines = truncateOutput(detail);
    return {
      summaryLine: 'Error',
      outputLines: lines.visible,
      allOutputLines: lines.all,
      totalOutputLines: lines.total,
    };
  }

  const trimmed = detail?.trim() ?? '';
  switch (toolName) {
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE: {
      const lines = truncateOutput(trimmed);
      const lineCount = lines.total;
      const fileMatch = trimmed.match(/^Wrote \d+ lines? to (.+)/);
      const summaryLine = fileMatch
        ? `Wrote ${lineCount} lines to ${fileMatch[1]}`
        : `Wrote ${lineCount} lines`;
      return {summaryLine, outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT: {
      const lines = truncateOutput(trimmed);
      return {summaryLine: buildEditSummary(trimmed), outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.BASH: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
    case TOOL_NAMES.AGENT: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const taskLines = trimmed.split('\n');
      return {summaryLine: taskLines[0] ?? 'Done', outputLines: taskLines.slice(1), allOutputLines: taskLines.slice(1), totalOutputLines: taskLines.length};
    }
    default: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
  }
}

export function buildEditSummary(detail: string): string {
  const lines = detail.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }
  if (added === 0 && removed === 0) {
    return 'Edited';
  }
  const parts: string[] = [];
  if (added > 0) {
    parts.push(`Added ${added} line${added === 1 ? '' : 's'}`);
  }
  if (removed > 0) {
    parts.push(`removed ${removed} line${removed === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

export function truncateOutput(detail?: string, maxLines: number = TOOL_META_MAX_LINES): {visible: string[]; all: string[]; total: number} {
  if (!detail?.trim()) {
    return {visible: [], all: [], total: 0};
  }
  const allLines = detail.trim().split('\n');
  const total = allLines.length;
  const visible = allLines.slice(0, maxLines);
  return {visible, all: allLines, total};
}

// ── Elapsed / args parsing ────────────────────────────────────────

export function formatElapsed(startTimestamp: string, endTimestamp: string): string {
  const ms = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  if (ms < 1000) {
    return `${Math.max(0, ms)}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function parseToolCallArgs(label: string): string | undefined {
  const match = label.match(/^[^(]+\((.+)\)$/s);
  return match?.[1]?.trim() || undefined;
}

// ── Event-based tool meta builders ────────────────────────────────

export function buildToolMetaFromEvents(
  rawToolName: string,
  startEvent: CodaraRuntimeEvent,
  endEvent: CodaraRuntimeEvent,
): ToolResultMeta | undefined {
  if (!rawToolName) {
    return undefined;
  }

  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);
  const status = endEvent.status === 'error' ? 'error' : 'done';
  const {summaryLine, outputLines, allOutputLines, totalOutputLines} = buildToolOutput(rawToolName, status, endEvent.detail);

  const elapsed = formatElapsed(startEvent.timestamp, endEvent.timestamp);

  return {toolName: rawToolName, displayName, icon, args, status, elapsed, summaryLine, outputLines, allOutputLines, totalOutputLines};
}

export function buildToolMetaRunning(rawToolName: string, startEvent: CodaraRuntimeEvent): ToolResultMeta | undefined {
  if (!rawToolName) {
    return undefined;
  }

  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);

  return {toolName: rawToolName, displayName, icon, args, status: 'running', summaryLine: '\u2026'};
}

// ── Agent label parsing ───────────────────────────────────────────

export function parseAgentRuntimeLabel(label: string): {displayName: string; args?: string} {
  const trimmed = label.trim();
  const concise = trimmed.startsWith('Delegating ') ? trimmed.slice('Delegating '.length) : trimmed;
  const separatorIndex = concise.indexOf(': ');
  if (separatorIndex <= 0) {
    return {displayName: concise || 'Agent'};
  }

  return {
    displayName: concise.slice(0, separatorIndex).trim() || 'Agent',
    args: concise.slice(separatorIndex + 2).trim() || undefined,
  };
}

export function buildAgentCoverageKey(
  displayName: string,
  args: string | undefined,
  status: 'running' | 'done' | 'error',
): string {
  return ['agent', displayName, args ?? '', status].join('|');
}

// ── Diff computation ──────────────────────────────────────────────

export function tryComputeDiff(toolName: string, toolArgs: unknown): DiffData | undefined {
  try {
    if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
      return undefined;
    }

    const record = toolArgs as Record<string, unknown>;
    const filePath = asString(record.file_path) || asString(record.path);
    if (!filePath) {
      return undefined;
    }

    switch (toolName) {
      case TOOL_NAMES.EDIT:
      case TOOL_NAMES.EDIT_FILE: {
        const oldString = asString(record.old_string);
        const newString = asString(record.new_string);
        if (oldString !== undefined && newString !== undefined) {
          return computeEditDiff(filePath, oldString, newString);
        }
        return undefined;
      }
      case TOOL_NAMES.WRITE:
      case TOOL_NAMES.WRITE_FILE: {
        const content = asString(record.content);
        if (content !== undefined) {
          const lines = content.split('\n');
          const additions = lines.length;
          return {
            filePath,
            hunks: [],
            additions,
            deletions: 0,
            isNewFile: true,
          };
        }
        return undefined;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

// ── Core message tool result builders ─────────────────────────────

export function buildToolResultItems(
  message: ToolMessage,
  messageId: string,
  index: number,
  allMessages: readonly import('@langchain/core/messages').BaseMessage[],
  toolLookup: Map<string, ToolCall>,
): TranscriptItem[] {
  if (shouldHideInternalToolMessage(message)) {
    return [];
  }

  const reviewPayload = parseReviewToolMessagePayload(message.content);
  if (reviewPayload?.type === 'review_pause') {
    return [];
  }
  if (reviewPayload?.type === 'review_deny') {
    return [{
      id: messageId,
      role: 'error',
      content: reviewPayload.reason,
    }];
  }

  const text = readMessageText(message);
  if (!text) {
    return [];
  }
  if (isRepeatedAskUserContinuationNotice(text)) {
    return [];
  }

  const resolvedName = resolveToolMessageName(message, toolLookup);
  if (isHiddenTranscriptToolName(resolvedName)) {
    return [];
  }
  if (isInteractionToolName(resolvedName) || parseAskUserResult(text)) {
    return [];
  }
  if (readSharedTaskCoordinationArtifact(message.artifact)) {
    return [];
  }
  if (resolvedName === TODO_TOOL_NAME) {
    return [];
  }
  if (resolvedName === TOOL_NAMES.AGENT) {
    const taskMeta = buildTaskToolMetaFromCoreMessage(message, index, allMessages, toolLookup);
    if (!taskMeta) {
      return [];
    }

    return [{
      id: messageId,
      role: 'agent',
      content: `${taskMeta.icon} ${taskMeta.displayName}(${taskMeta.args ?? ''})\n${taskMeta.summaryLine}`,
      toolMeta: taskMeta,
    }];
  }
  const role: TranscriptRole = 'tool';
  const formattedContent = text;
  const lineCount = formattedContent.split('\n').length;

  const toolMeta = resolvedName && !isAgentToolName(resolvedName)
    ? buildToolMetaFromCoreMessage(resolvedName, message, toolLookup, text)
    : undefined;

  return [{
    id: messageId,
    role,
    content: toolMeta
      ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
      : formattedContent,
    renderHint: lineCount > 3 ? 'block' : 'inline',
    toolMeta,
  }];
}

function buildToolMetaFromCoreMessage(
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
  const {summaryLine, outputLines, allOutputLines, totalOutputLines} = buildToolOutput(rawToolName, status as 'done' | 'error', text);

  const diffData = toolCall ? tryComputeDiff(rawToolName, toolCall.args) : undefined;

  return {toolName: rawToolName, displayName, icon, args, status: status as 'done' | 'error', summaryLine, outputLines, allOutputLines, totalOutputLines, diffData};
}

function buildTaskToolMetaFromCoreMessage(
  message: ToolMessage,
  index: number,
  allMessages: readonly import('@langchain/core/messages').BaseMessage[],
  toolLookup: Map<string, ToolCall>,
): ToolResultMeta | undefined {
  const launched = readSubagentRunLaunchResult(message.artifact);
  if (launched) {
    if (hasCompletedSubagentResultForToolCall(message, index, allMessages)) {
      return undefined;
    }

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
  if (!fallbackText) {
    return undefined;
  }

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
  if (!toolCallId) {
    return false;
  }

  for (let cursor = index + 1; cursor < allMessages.length; cursor += 1) {
    const candidate = allMessages[cursor];
    if (!candidate || !ToolMessage.isInstance(candidate)) {
      continue;
    }

    const candidateToolCallId = typeof candidate.tool_call_id === 'string' ? candidate.tool_call_id.trim() : '';
    if (candidateToolCallId !== toolCallId) {
      continue;
    }

    if (readSubagentResult(candidate.artifact)) {
      return true;
    }
  }

  return false;
}

function formatTaskToolAgentName(toolCall: ToolCall | undefined): string {
  const subagentType = normalizeSubagentType(readTaskToolArg(toolCall?.args, 'subagent_type'));
  if (!subagentType) {
    return 'Agent';
  }
  return formatSubagentDisplayName(subagentType);
}

function readTaskToolPrompt(toolCall: ToolCall | undefined): string | undefined {
  return readTaskToolArg(toolCall?.args, 'prompt');
}

function readTaskToolArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function shouldHideInternalToolMessage(message: ToolMessage): boolean {
  const artifact = message.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return false;
  }

  const record = artifact as Record<string, unknown>;
  return record.type === 'ask_user_internal' && record.visibility === 'hidden';
}

export function resolveToolMessageName(message: ToolMessage, toolLookup: Map<string, ToolCall>): string | undefined {
  const explicitName = typeof message.name === 'string' ? message.name.trim() : '';
  if (explicitName) {
    return explicitName;
  }

  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  if (!toolCallId) {
    return undefined;
  }

  return toolLookup.get(toolCallId)?.name;
}

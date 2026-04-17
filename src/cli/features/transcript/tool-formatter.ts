/**
 * Runtime-event tool formatting and tool-name predicates.
 *
 * Core-message (ToolMessage → TranscriptItem) logic lives in tool-message-builder.ts.
 */
import {TOOL_NAMES, formatToolDisplayName} from '@shared/tool-display';
import type {ToolResultMeta} from './model';
import type {CodaraRuntimeEvent} from '@/index';

// ── Constants ────────────────────────────────────────────────────

export const TODO_TOOL_NAME = 'write_todos';
export const TOOL_META_MAX_LINES = 4;

// ── Tool name predicates ─────────────────────────────────────────

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

// ── Shared tool output helpers ───────────────────────────────────

export function toolIcon(toolName: string): string {
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

export function truncateOutput(detail?: string, maxLines: number = TOOL_META_MAX_LINES): {visible: string[]; all: string[]; total: number} {
  if (!detail?.trim()) return {visible: [], all: [], total: 0};
  const allLines = detail.trim().split('\n');
  return {visible: allLines.slice(0, maxLines), all: allLines, total: allLines.length};
}

export function buildEditSummary(detail: string): string {
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

export function buildToolOutput(
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

// ── Elapsed / args parsing ───────────────────────────────────────

export function formatElapsed(startTimestamp: string, endTimestamp: string): string {
  const ms = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function parseToolCallArgs(label: string): string | undefined {
  const match = label.match(/^[^(]+\((.+)\)$/s);
  return match?.[1]?.trim() || undefined;
}

// ── Event-based tool meta builders ───────────────────────────────

export function buildToolMetaFromEvents(
  rawToolName: string,
  startEvent: CodaraRuntimeEvent,
  endEvent: CodaraRuntimeEvent,
): ToolResultMeta | undefined {
  if (!rawToolName) return undefined;
  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);
  const status = endEvent.status === 'error' ? 'error' : 'done';
  const output = buildToolOutput(rawToolName, status, endEvent.detail);
  const elapsed = formatElapsed(startEvent.timestamp, endEvent.timestamp);
  return {toolName: rawToolName, displayName, icon, args, status, elapsed, ...output};
}

export function buildToolMetaRunning(rawToolName: string, startEvent: CodaraRuntimeEvent): ToolResultMeta | undefined {
  if (!rawToolName) return undefined;
  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);
  return {toolName: rawToolName, displayName, icon, args, status: 'running', summaryLine: '\u2026'};
}

// ── Agent label parsing ──────────────────────────────────────────

export function parseAgentRuntimeLabel(label: string): {displayName: string; args?: string} {
  const trimmed = label.trim();
  const concise = trimmed.startsWith('Delegating ') ? trimmed.slice('Delegating '.length) : trimmed;
  const separatorIndex = concise.indexOf(': ');
  if (separatorIndex <= 0) return {displayName: concise || 'Agent'};
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

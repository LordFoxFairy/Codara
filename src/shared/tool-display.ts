/**
 * Tool display formatting — human-readable summaries and display names.
 *
 * Used by runtime-events, transcript/model, and child-activity-forward middleware.
 */

import path from 'node:path';
import {TOOL_NAMES} from '@shared/tool-names';

// Re-export so existing `import { TOOL_NAMES } from '@shared/tool-display'` still works.
export {TOOL_NAMES} from '@shared/tool-names';

// ── Generic string helpers ──

/** Read a trimmed non-empty string, or undefined. */
export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

// ── Tool summary / display ──

/**
 * Produce a one-line summary of a tool call's arguments.
 * Single source of truth for runtime-events, transcript, and delegation.
 */
export function formatToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;

  const record = args as Record<string, unknown>;
  switch (toolName) {
    case TOOL_NAMES.BASH:
      return readString(record.command) ?? readString(record.description);
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return readString(record.file_path) ?? readString(record.path);
    case TOOL_NAMES.GLOB:
    case TOOL_NAMES.GREP:
      return readString(record.pattern);
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return readString(record.url);
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return readString(record.query);
    case TOOL_NAMES.AGENT:
      return normalizeSubagentType(readString(record.subagent_type))
        ? `Delegating ${formatSubagentDisplayName(readString(record.subagent_type))}`
        : 'Delegating Agent';
    case TOOL_NAMES.TASK_CREATE:
    case TOOL_NAMES.TASK_UPDATE:
      return readString(record.subject) ?? readString(record.taskId);
    case TOOL_NAMES.ASK_USER:
      return readString(record.summary) ? `summary: ${readString(record.summary)}` : undefined;
    case TOOL_NAMES.MEMORY_WRITE:
    case TOOL_NAMES.MEMORY_READ:
      return readString(record.name);
    case TOOL_NAMES.MEMORY_LIST:
      return readString(record.query);
    default:
      return undefined;
  }
}

/** Map a tool's internal name to a human-readable display name. */
export function formatToolDisplayName(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL:       return 'Skill';
    case TOOL_NAMES.BASH:        return 'Bash';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:        return 'Read';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:       return 'Write';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:        return 'Edit';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:       return 'Fetch';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:      return 'Search';
    case TOOL_NAMES.GLOB:        return 'Glob';
    case TOOL_NAMES.GREP:        return 'Grep';
    default:                     return toTitleCase(toolName);
  }
}

/** Format the header args shown next to a tool name in the transcript. */
export function formatToolHeaderArgs(toolName: string, args: string | undefined): string | undefined {
  if (!args) return undefined;

  if (toolName === TOOL_NAMES.AGENT) return summarizeAgentPrompt(args);

  if (
    toolName === TOOL_NAMES.READ_FILE || toolName === TOOL_NAMES.READ
    || toolName === TOOL_NAMES.WRITE_FILE || toolName === TOOL_NAMES.WRITE
    || toolName === TOOL_NAMES.EDIT_FILE || toolName === TOOL_NAMES.EDIT
  ) {
    return simplifyPath(args);
  }

  return args;
}

// ── Subagent display helpers ──

/** Normalize a subagent type string — trims whitespace and returns undefined for empty values. */
export function normalizeSubagentType(subagentType: string | undefined): string | undefined {
  const normalized = subagentType?.trim();
  return normalized || undefined;
}

/** Format a human-readable display name for a subagent type. Falls back to "Agent". */
export function formatSubagentDisplayName(subagentType: string | undefined): string {
  return normalizeSubagentType(subagentType) ?? 'Agent';
}

// ── Private helpers ──

function simplifyPath(value: string): string {
  if (!value.startsWith('/')) return value;
  return path.basename(value) || value;
}

/** Extract a one-sentence summary from an agent delegation prompt. */
function summarizeAgentPrompt(value: string): string {
  const firstLine = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const normalized = (firstLine ?? value).replace(/\s+/g, ' ').trim();
  if (!normalized) return value.trim();

  // Try to cut at a sentence boundary
  const sentenceEnd = normalized.search(/[。！？.!?]/);
  if (sentenceEnd > 0) return normalized.slice(0, sentenceEnd + 1).trim();

  const colonEnd = normalized.search(/[：:]/);
  if (colonEnd > 0) return normalized.slice(0, colonEnd + 1).trim();

  return normalized;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

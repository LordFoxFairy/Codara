import path from 'node:path';

/** Canonical tool name constants to avoid magic strings across the codebase. */
export const TOOL_NAMES = {
  SKILL: 'Skill',
  BASH: 'bash',
  READ_FILE: 'read_file',
  READ: 'read',
  WRITE_FILE: 'write_file',
  WRITE: 'write',
  EDIT_FILE: 'edit_file',
  EDIT: 'edit',
  GLOB: 'glob',
  GREP: 'grep',
  FETCH_URL: 'fetch_url',
  FETCH: 'fetch',
  WEB_SEARCH: 'web_search',
  SEARCH: 'search',
  AGENT: 'Agent',
  TASK_CREATE: 'TaskCreate',
  TASK_UPDATE: 'TaskUpdate',
  TASK_LIST: 'TaskList',
  ASK_USER: 'AskUserQuestion',
  MEMORY_WRITE: 'MemoryWrite',
  MEMORY_READ: 'MemoryRead',
  MEMORY_LIST: 'MemoryList',
} as const;

/**
 * Produce a one-line summary of a tool call's arguments.
 *
 * This is the single source of truth — used by runtime-events, transcript/model,
 * and the child-activity-forward middleware in delegation.ts.
 */
export function formatToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

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
      return readString(record.pattern);
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
      return readString(record.summary)
        ? `summary: ${readString(record.summary)}`
        : undefined;
    case TOOL_NAMES.MEMORY_WRITE:
    case TOOL_NAMES.MEMORY_READ:
      return readString(record.name);
    case TOOL_NAMES.MEMORY_LIST:
      return readString(record.query);
    default:
      return undefined;
  }
}

export function formatToolDisplayName(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return 'Skill';
    case TOOL_NAMES.BASH:
      return 'Bash';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return 'Read';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
      return 'Write';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return 'Edit';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return 'Fetch';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return 'Search';
    case TOOL_NAMES.GLOB:
      return 'Glob';
    case TOOL_NAMES.GREP:
      return 'Grep';
    default:
      return toTitleCase(toolName);
  }
}

export function formatToolHeaderArgs(toolName: string, args: string | undefined): string | undefined {
  if (!args) {
    return undefined;
  }

  if (toolName === TOOL_NAMES.AGENT) {
    return summarizeAgentPrompt(args);
  }

  if (
    toolName === TOOL_NAMES.READ_FILE
    || toolName === TOOL_NAMES.READ
    || toolName === TOOL_NAMES.WRITE_FILE
    || toolName === TOOL_NAMES.WRITE
    || toolName === TOOL_NAMES.EDIT_FILE
    || toolName === TOOL_NAMES.EDIT
  ) {
    return simplifyPath(args);
  }

  return args;
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function simplifyPath(value: string): string {
  if (!value.startsWith('/')) {
    return value;
  }

  const basename = path.basename(value);
  return basename || value;
}

function summarizeAgentPrompt(value: string): string {
  const firstMeaningfulLine = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const normalized = (firstMeaningfulLine ?? value)
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return value.trim();
  }

  const sentenceBoundary = normalized.search(/[。！？.!?]/);
  if (sentenceBoundary > 0) {
    return normalized.slice(0, sentenceBoundary + 1).trim();
  }

  const colonBoundary = normalized.search(/[：:]/);
  if (colonBoundary > 0) {
    return normalized.slice(0, colonBoundary + 1).trim();
  }

  return normalized;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Normalize a subagent type string — trims whitespace and returns undefined for empty values.
 * Moved here from capability/skill so shared layer has no upward dependency.
 */
export function normalizeSubagentType(subagentType: string | undefined): string | undefined {
  const normalized = subagentType?.trim();
  return normalized || undefined;
}

/**
 * Format a human-readable display name for a subagent type.
 * Falls back to the default "Agent" label when the type is empty.
 */
export function formatSubagentDisplayName(subagentType: string | undefined): string {
  return normalizeSubagentType(subagentType) ?? 'Agent';
}

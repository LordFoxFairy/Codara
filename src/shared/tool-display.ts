import {formatSubagentDisplayName, normalizeSubagentType} from '@context/skills/runtime-shared';

/** Canonical tool name constants to avoid magic strings across the codebase. */
export const TOOL_NAMES = {
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
  TASK: 'Task',
  TASK_CREATE: 'TaskCreate',
  TASK_UPDATE: 'TaskUpdate',
  TASK_LIST: 'TaskList',
  ASK_USER: 'AskUserQuestion',
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
    case TOOL_NAMES.TASK:
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
    default:
      return undefined;
  }
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

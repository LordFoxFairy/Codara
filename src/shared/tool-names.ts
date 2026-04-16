/**
 * Canonical tool name constants and alias resolution.
 *
 * TOOL_NAMES avoids magic strings across the codebase.
 * normalizeToolReferenceName resolves user-facing aliases (e.g. "read" -> "read_file")
 * for permission rules and tool references.
 */

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
 * Map user-facing tool names (case-insensitive) to their canonical internal names.
 * Used by permission rules where users write "read" but the tool is "read_file".
 */
const TOOL_REFERENCE_ALIASES: Record<string, string> = {
  bash: 'bash',
  glob: 'glob',
  grep: 'grep',
  read: 'read_file',
  read_file: 'read_file',
  write: 'write_file',
  write_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  fetch: 'fetch_url',
  fetch_url: 'fetch_url',
  webfetch: 'fetch_url',
  search: 'web_search',
  web_search: 'web_search',
  websearch: 'web_search',
  notebook: 'notebook_read',
  notebook_read: 'notebook_read',
  enter_worktree: 'enter_worktree',
  exit_worktree: 'exit_worktree',
  list_worktrees: 'list_worktrees',
};

export function normalizeToolReferenceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return TOOL_REFERENCE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

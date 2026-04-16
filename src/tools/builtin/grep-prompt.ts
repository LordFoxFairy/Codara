/**
 * Grep tool prompt — system-level instructions for content search.
 *
 * Aligned with Claude Code GrepTool prompt pattern:
 * - Regex pattern support
 * - Output mode documentation
 * - File type filtering
 * - Multiline matching
 */

export const GREP_TOOL_NAME = 'grep';

export function getGrepToolPrompt(): string {
  return [
    'A powerful search tool built on ripgrep',
    '',
    'Usage:',
    '- ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command.',
    '- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")',
    '- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")',
    '- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts',
    '- Pattern syntax: Uses ripgrep (not grep) — literal braces need escaping',
    '- Multiline matching: By default patterns match within single lines only. For cross-line patterns, use `multiline: true`',
  ].join('\n');
}

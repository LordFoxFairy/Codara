/**
 * Glob tool prompt — system-level instructions for file pattern matching.
 *
 * Aligned with Claude Code GlobTool prompt pattern:
 * - Fast file discovery by name pattern
 * - Exclusion behavior documentation
 * - Result ordering
 */

export const GLOB_TOOL_NAME = 'glob';

export function getGlobToolPrompt(): string {
  return [
    '- Fast file pattern matching tool that works with any codebase size',
    '- Supports glob patterns like "**/*.js" or "src/**/*.ts"',
    '- Returns matching file paths sorted by modification time',
    '- Use this tool when you need to find files by name patterns',
    '- Automatically excludes node_modules, .git, dist, and other VCS directories',
    '- Hidden directories (starting with .) are excluded by default',
    '- Maximum 200 results returned; use a more specific pattern if needed',
  ].join('\n');
}

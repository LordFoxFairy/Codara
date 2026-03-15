/**
 * Pure glob/wildcard matching utilities for the permission system.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a glob pattern (with `*` wildcards) to a RegExp.
 * Only `*` is supported as a wildcard (matches any sequence of characters).
 */
export function globToRegExp(pattern: string, caseInsensitive = false): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

/**
 * Test if a value matches a glob pattern.
 * Patterns support `*` as a wildcard.
 * A `*` pattern matches everything.
 */
export function match(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  if (!pattern.includes('*')) {
    return value === pattern;
  }
  return globToRegExp(pattern, true).test(value);
}

/**
 * Test if a tool name matches a rule tool pattern (case-insensitive).
 */
export function matchTool(callTool: string, ruleTool: string): boolean {
  return globToRegExp(ruleTool, true).test(callTool);
}

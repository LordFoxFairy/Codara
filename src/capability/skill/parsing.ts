/**
 * Shared parsing utilities for allowed-tools references.
 *
 * Both SKILL.md frontmatter loading and skill-command requirements
 * need to parse the `Tool(specifier)` syntax (e.g. `Bash(grep)`).
 * This module provides the canonical implementation.
 */

export interface ToolCallReference {
  /** Raw tool name portion, e.g. "Bash" */
  toolName: string;
  /** Specifier inside parentheses, e.g. "grep" */
  specifier: string;
}

/**
 * Parse a `Tool(specifier)` reference string.
 *
 * Returns the tool name and specifier, or undefined if the input
 * does not match the `Name(body)` pattern.
 *
 * Examples:
 *   "Bash(grep)"      -> { toolName: "Bash", specifier: "grep" }
 *   "Bash(gh pr:*)"   -> { toolName: "Bash", specifier: "gh pr:*" }
 *   "read"            -> undefined (no parentheses)
 */
export function parseToolCallReference(reference: string): ToolCallReference | undefined {
  const trimmed = reference.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/^([A-Za-z0-9_-]+)\((.*)\)$/);
  if (!match) return undefined;

  return {
    toolName: match[1] ?? '',
    specifier: (match[2] ?? '').trim(),
  };
}

/**
 * Split a comma/space-separated allowed-tools string into individual tokens,
 * respecting parenthesized groups like `Bash(grep)`.
 */
export function splitAllowedToolTokens(raw: string): string[] {
  const tools: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of raw) {
    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      depth = Math.max(depth - 1, 0);
      current += char;
      continue;
    }

    const isSeparator = (char === ',' || /\s/.test(char)) && depth === 0;
    if (isSeparator) {
      const token = current.trim();
      if (token) {
        tools.push(token);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) {
    tools.push(last);
  }

  return tools;
}

import {existsSync} from 'node:fs';

/**
 * Shared source constant for all built-in commands.
 * Eliminates the repeated `{type: 'builtin'} as const` in every command file.
 */
export const BUILTIN_SOURCE = {type: 'builtin'} as const;

/**
 * Format a context window summary as a single-line string.
 * Used by status and context commands.
 */
export function formatContextWindow(contextWindow: {
  maxInputTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  usagePercent: number;
  overBudget: boolean;
} | undefined): string {
  if (!contextWindow) {
    return 'n/a';
  }

  return `${Math.round(contextWindow.usagePercent)}% (${contextWindow.estimatedInputTokens}/${contextWindow.maxInputTokens})${contextWindow.overBudget ? ' over-budget' : ''}`;
}

/**
 * Format usage statistics as a single-line summary.
 * Used by status and config commands.
 */
export function formatUsage(usage: {
  modelCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} | undefined): string {
  if (!usage) {
    return 'n/a';
  }

  return `model_calls=${usage.modelCalls ?? 0}, prompt=${usage.promptTokens ?? 0}, completion=${usage.completionTokens ?? 0}, total=${usage.totalTokens ?? 0}`;
}

/**
 * Format a token count with human-readable units (k, M).
 * Used by cost and config commands.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format a file path with an existence indicator suffix.
 * Returns the path with ' (missing)' appended if the file does not exist.
 */
export function formatFilePath(filePath: string): string {
  return `${filePath}${existsSync(filePath) ? '' : ' (missing)'}`;
}

/**
 * Format a titled section with indented content lines.
 */
export function formatSection(title: string, lines: string[]): string {
  return [title, ...lines.map(line => `  ${line}`)].join('\n');
}

/**
 * Format a key-value pair with consistent alignment.
 * @param key - The label
 * @param value - The value to display
 * @param padTo - Optional padding width for the key (default: 0, no padding)
 */
export function formatKeyValue(key: string, value: string | number, padTo = 0): string {
  const paddedKey = padTo > 0 ? `${key}:`.padEnd(padTo) : `${key}:`;
  return `${paddedKey} ${value}`;
}

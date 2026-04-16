/**
 * Tool metadata registry — maps tool names to their safety classification.
 *
 * Aligned with Claude Code's per-tool metadata design where each tool declares
 * isReadOnly, isConcurrencySafe, isDestructive, and interruptBehavior.
 *
 * This is the single source of truth — used by:
 * - tool-concurrency.ts for partitioning concurrent vs serial execution
 * - permission middleware for smarter default decisions
 */
import {
  TOOL_METADATA_DEFAULTS,
  type ToolMetadata,
  type ToolMetadataInput,
} from '@shared/contracts/tool-metadata';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, ToolMetadata>();

/**
 * Register metadata for a tool. Unset fields fall back to TOOL_METADATA_DEFAULTS.
 */
export function registerToolMetadata(toolName: string, input: ToolMetadataInput): void {
  registry.set(toolName, {...TOOL_METADATA_DEFAULTS, ...input});
}

/**
 * Look up metadata for a tool. Returns TOOL_METADATA_DEFAULTS for unknown tools
 * (fail-closed: not read-only, not concurrent-safe, not destructive, block on interrupt).
 */
export function getToolMetadata(toolName: string): Readonly<ToolMetadata> {
  return registry.get(toolName) ?? TOOL_METADATA_DEFAULTS;
}

/**
 * Check if a tool is read-only (does not mutate files or external state).
 * Drop-in replacement for the old `isToolReadOnly()` function.
 */
export function isToolReadOnly(tool: {name: string}): boolean {
  return getToolMetadata(tool.name).isReadOnly;
}

/**
 * Check if a tool is safe for concurrent execution.
 */
export function isToolConcurrencySafe(tool: {name: string}): boolean {
  return getToolMetadata(tool.name).isConcurrencySafe;
}

/**
 * Check if a tool performs irreversible operations.
 */
export function isToolDestructive(tool: {name: string}): boolean {
  return getToolMetadata(tool.name).isDestructive;
}

/**
 * Get the interrupt behavior for a tool.
 */
export function getToolInterruptBehavior(tool: {name: string}): 'cancel' | 'block' {
  return getToolMetadata(tool.name).interruptBehavior;
}

// ---------------------------------------------------------------------------
// Builtin tool registrations
// ---------------------------------------------------------------------------
// Aligned with Claude Code's per-tool metadata declarations.
// Each tool declares its worst-case (input-independent) metadata.

// --- Read-only & concurrency-safe tools ---

registerToolMetadata('read_file', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('glob', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('grep', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('fetch_url', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('web_search', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('notebook_read', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

registerToolMetadata('list_worktrees', {
  isReadOnly: true,
  isConcurrencySafe: true,
});

// --- Write tools (not read-only, not concurrency-safe) ---

registerToolMetadata('bash', {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false, // input-dependent in practice; worst-case default
  interruptBehavior: 'cancel',
});

registerToolMetadata('edit_file', {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
});

registerToolMetadata('write_file', {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
});

// --- Worktree tools ---

registerToolMetadata('enter_worktree', {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
});

registerToolMetadata('exit_worktree', {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
});

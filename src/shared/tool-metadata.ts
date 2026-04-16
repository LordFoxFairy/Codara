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

// ── Types ──

export interface ToolMetadata {
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isDestructive: boolean;
  interruptBehavior: 'cancel' | 'block';
}

export type ToolMetadataInput = Partial<ToolMetadata>;

/** Fail-closed defaults: not read-only, not concurrent-safe, not destructive, block on interrupt. */
export const TOOL_METADATA_DEFAULTS: Readonly<ToolMetadata> = {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  interruptBehavior: 'block',
};

// ── Registry ──

const registry = new Map<string, ToolMetadata>();

/** Register metadata for a tool. Unset fields fall back to TOOL_METADATA_DEFAULTS. */
export function registerToolMetadata(toolName: string, input: ToolMetadataInput): void {
  registry.set(toolName, {...TOOL_METADATA_DEFAULTS, ...input});
}

/**
 * Look up metadata for a tool. Returns TOOL_METADATA_DEFAULTS for unknown tools.
 */
export function getToolMetadata(toolName: string): Readonly<ToolMetadata> {
  return registry.get(toolName) ?? TOOL_METADATA_DEFAULTS;
}

/**
 * Check if a tool is read-only (does not mutate files or external state).
 */
export function isToolReadOnly(tool: {name: string}): boolean {
  return getToolMetadata(tool.name).isReadOnly;
}

// ── Builtin registrations ──
// Each tool declares its worst-case (input-independent) metadata.

registerToolMetadata('read_file', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('glob', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('grep', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('fetch_url', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('web_search', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('notebook_read', {isReadOnly: true, isConcurrencySafe: true});
registerToolMetadata('list_worktrees', {isReadOnly: true, isConcurrencySafe: true});

registerToolMetadata('bash', {isReadOnly: false, isConcurrencySafe: false, interruptBehavior: 'cancel'});
registerToolMetadata('edit_file', {isReadOnly: false, isConcurrencySafe: false});
registerToolMetadata('write_file', {isReadOnly: false, isConcurrencySafe: false});
registerToolMetadata('enter_worktree', {isReadOnly: false, isConcurrencySafe: false});
registerToolMetadata('exit_worktree', {isReadOnly: false, isConcurrencySafe: false});

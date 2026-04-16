/**
 * Per-tool safety metadata — aligned with Claude Code's Tool interface.
 *
 * In Claude Code, these are methods on each Tool object (isReadOnly, isConcurrencySafe,
 * isDestructive, interruptBehavior). Codara uses LangChain StructuredTool, so we express
 * the same semantics as a registry of static metadata keyed by tool name.
 *
 * For input-dependent decisions (e.g., Bash is read-only only for certain commands),
 * the metadata represents the **default/worst-case** — callers that need input-aware
 * classification should layer additional logic on top.
 */
export interface ToolMetadata {
  /**
   * Whether the tool only reads state and never mutates files, environment, or
   * external services. Read-only tools can safely execute concurrently.
   *
   * Aligned with Claude Code's `Tool.isReadOnly(input)`.
   * Default: false (assume writes — fail-closed).
   */
  isReadOnly: boolean;

  /**
   * Whether the tool can safely run concurrently with other tool calls.
   * A superset of isReadOnly — some tools that write can still be concurrent
   * if they operate on independent resources.
   *
   * Aligned with Claude Code's `Tool.isConcurrencySafe(input)`.
   * Default: false (assume not safe).
   */
  isConcurrencySafe: boolean;

  /**
   * Whether the tool performs irreversible operations (delete, overwrite, send).
   * Used by the permission system to decide default confirmation behavior.
   *
   * Aligned with Claude Code's `Tool.isDestructive(input)`.
   * Default: false.
   */
  isDestructive: boolean;

  /**
   * What should happen when the user submits a new message while this tool
   * is running.
   *
   * - `'cancel'` — stop the tool and discard its result
   * - `'block'`  — keep running; the new message waits
   *
   * Aligned with Claude Code's `Tool.interruptBehavior()`.
   * Default: 'block'.
   */
  interruptBehavior: 'cancel' | 'block';
}

/**
 * Partial metadata for registration — unset fields fall back to
 * TOOL_METADATA_DEFAULTS (fail-closed: not read-only, not concurrent,
 * not destructive, block on interrupt).
 */
export type ToolMetadataInput = Partial<ToolMetadata>;

/**
 * Fail-closed defaults aligned with Claude Code's `buildTool` TOOL_DEFAULTS:
 * - isReadOnly → false
 * - isConcurrencySafe → false
 * - isDestructive → false
 * - interruptBehavior → 'block'
 */
export const TOOL_METADATA_DEFAULTS: Readonly<ToolMetadata> = {
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  interruptBehavior: 'block',
};

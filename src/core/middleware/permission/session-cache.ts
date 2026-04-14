import type {PermissionAction} from '@core/middleware/permission/types';

/**
 * In-memory permission decision cache scoped to a single session.
 *
 * Stores "always allow" / "always deny" decisions the user made during
 * the current session. The cache is garbage-collected when the session ends.
 *
 * Key format:
 *   - Tool-level: `"Bash"` or `"Read"`
 *   - Pattern-level: `"Bash(git *)"` or `"Edit(src/components/*)"``
 */
export class PermissionSessionCache {
  private decisions = new Map<string, PermissionAction>();

  /** Store a session-scoped decision. */
  remember(toolExpression: string, decision: PermissionAction): void {
    this.decisions.set(toolExpression, decision);
  }

  /** Check if there's a cached decision. Returns undefined on miss. */
  lookup(toolExpression: string): PermissionAction | undefined {
    return this.decisions.get(toolExpression);
  }

  /** Clear all cached decisions. */
  clear(): void {
    this.decisions.clear();
  }

  /** Number of cached decisions. */
  get size(): number {
    return this.decisions.size;
  }
}

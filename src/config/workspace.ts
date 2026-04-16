import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import path from 'node:path';

// ── Workspace root resolution ────────────────────────────────────────

const WORKSPACE_MARKERS = ['.codara', '.git', 'package.json'] as const;

export interface WorkspaceRootOptions {
  cwd?: string;
  projectRoot?: string;
}

/**
 * Resolve the workspace root by walking up from `cwd` until a marker
 * directory/file is found. If `projectRoot` is provided, it wins outright.
 */
export function resolveWorkspaceRoot(options: WorkspaceRootOptions = {}): string {
  if (options.projectRoot) {
    return path.resolve(options.projectRoot);
  }

  let current = path.resolve(options.cwd ?? process.cwd());
  while (true) {
    if (WORKSPACE_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(options.cwd ?? process.cwd());
    }
    current = parent;
  }
}

// ── Workspace key ────────────────────────────────────────────────────

/**
 * Generate a deterministic workspace key from a project root path.
 * Format: `{sanitized-basename}-{sha1-first-12-chars}`
 *
 * Used by: project-scoped user config (CODARA.md, memory directory).
 */
export function createWorkspaceKey(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  const base = sanitizeSlug(path.basename(resolved)) || 'workspace';
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  return `${base}-${digest}`;
}

/** Sanitize a string into a URL/filesystem-safe slug. */
export function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`'"""'']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

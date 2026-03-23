import {createHash} from 'node:crypto';
import path from 'node:path';

/**
 * Generate a deterministic workspace key from a project root path.
 * Format: `{sanitized-basename}-{sha1-first-12-chars}`
 *
 * Used by: project-scoped user config (AGENTS.md / codara.md).
 */
export function createWorkspaceKey(projectRoot: string): string {
  const base = sanitizeSlug(path.basename(path.resolve(projectRoot))) || 'workspace';
  const digest = createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
  return `${base}-${digest}`;
}

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

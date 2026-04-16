/**
 * Durable storage key utilities.
 *
 * Maps logical identifiers (session IDs, checkpoint IDs) to filesystem-safe
 * directory names. A "candidates" variant returns both the preferred path and
 * the legacy raw-id path so that readers can transparently migrate old layouts.
 *
 * @module
 */

import path from 'node:path';
import {toFilesystemSafeId} from '@shared/filesystem-safe-id';

export {toFilesystemSafeId};

/** Resolve the preferred storage directory for a given identifier. */
export function resolveDurableStoragePath(rootDir: string, id: string): string {
  return path.join(rootDir, toFilesystemSafeId(id));
}

/**
 * Return candidate paths in priority order: preferred (filesystem-safe) first,
 * then the legacy raw-id path if it differs. Readers should iterate candidates
 * and stop at the first hit.
 */
export function resolveDurableStoragePathCandidates(rootDir: string, id: string): string[] {
  const preferred = resolveDurableStoragePath(rootDir, id);
  const legacy = path.join(rootDir, id);
  return preferred === legacy ? [preferred] : [preferred, legacy];
}

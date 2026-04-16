/**
 * Transcript storage path resolution.
 *
 * Transcripts are stored as JSONL files under `~/.codara/projects/<slug>/`.
 * The slug is derived from the project directory name, and the filename from
 * the session ID -- both sanitized for filesystem safety.
 *
 * This mirrors Claude Code's `getTranscriptPath()` in `sessionStorage.ts`,
 * but uses Codara's own `~/.codara` config home instead of `~/.claude`.
 *
 * @module
 */

import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {toFilesystemSafeId} from '@shared/filesystem-safe-id';

export {toFilesystemSafeId};

/** Resolve the JSONL transcript path for a specific session within a project. */
export function getTranscriptPath(options: {
  projectRoot: string;
  userHome: string;
  sessionId: string;
}): string {
  const projectSlug = toFilesystemSafeId(path.basename(options.projectRoot));
  return path.join(
    options.userHome, '.codara', 'projects', projectSlug,
    `${toFilesystemSafeId(options.sessionId)}.jsonl`,
  );
}

/** List all JSONL transcript files for a project. Returns absolute paths. */
export async function listSessionTranscripts(options: {
  projectRoot: string;
  userHome: string;
}): Promise<string[]> {
  const dir = path.join(
    options.userHome, '.codara', 'projects',
    toFilesystemSafeId(path.basename(options.projectRoot)),
  );
  try {
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

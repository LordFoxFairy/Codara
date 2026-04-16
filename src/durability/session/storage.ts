import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {toFilesystemSafeId} from '@shared/filesystem-safe-id';

export {toFilesystemSafeId};

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

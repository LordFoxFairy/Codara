import path from 'node:path';
import {toFilesystemSafeId} from '@shared/filesystem-safe-id';

export {toFilesystemSafeId};

export function resolveDurableStoragePath(rootDir: string, id: string): string {
  return path.join(rootDir, toFilesystemSafeId(id));
}

export function resolveDurableStoragePathCandidates(rootDir: string, id: string): string[] {
  const preferred = resolveDurableStoragePath(rootDir, id);
  const legacy = path.join(rootDir, id);
  return preferred === legacy ? [preferred] : [preferred, legacy];
}

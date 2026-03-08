import {homedir} from 'node:os';
import path from 'node:path';
import type {MemoryFile, MemorySourceOptions} from '@core/memory/types';
import {resolveWorkspaceRoot} from '@core/workspace';

const MEMORY_FILE_NAME = 'MEMORY.md';

/** 发现当前环境中可用的 MEMORY.md 文件。 */
export function discoverMemoryFiles(options: MemorySourceOptions = {}): MemoryFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', MEMORY_FILE_NAME),
    },
    {
      scope: 'project',
      path: path.join(projectRoot, MEMORY_FILE_NAME),
    },
  ];
}

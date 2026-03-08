import {homedir} from 'node:os';
import path from 'node:path';
import type {MemoryFile, MemoryOptions} from '@core/memory/types';

const MEMORY_FILE_NAME = 'MEMORY.md';

/** 发现当前环境中可用的 MEMORY.md 文件。 */
export function discoverMemoryFiles(options: MemoryOptions = {}): MemoryFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());

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

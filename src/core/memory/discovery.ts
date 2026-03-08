import type {MemoryFile, MemorySourceOptions} from '@core/memory/types';
import {discoverWorkspaceFiles} from '@core/workspace';

const MEMORY_FILE_NAME = 'MEMORY.md';

/** 发现当前环境中可用的 MEMORY.md 文件。 */
export function discoverMemoryFiles(options: MemorySourceOptions = {}): MemoryFile[] {
  return discoverWorkspaceFiles(MEMORY_FILE_NAME, options);
}

import {discoverMemoryFiles} from '@core/memory/discovery';
import {formatMemory} from '@core/memory/format';
import type {LoadedMemory, MemoryLoadOptions} from '@core/memory/types';
import {loadWorkspaceFiles} from '@core/workspace';

/** 加载并拼接当前环境中的 MEMORY.md 内容。 */
export async function loadMemory(options: MemoryLoadOptions = {}): Promise<LoadedMemory | undefined> {
  const files = await loadWorkspaceFiles(discoverMemoryFiles(options));

  if (files.length === 0) {
    return undefined;
  }

  return {
    files,
    content: formatMemory(files, {maxChars: options.maxChars}),
  };
}

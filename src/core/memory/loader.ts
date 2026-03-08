import {access, readFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {discoverMemoryFiles} from '@core/memory/discovery';
import {formatMemory} from '@core/memory/format';
import type {LoadedMemory, MemoryOptions} from '@core/memory/types';

/** 加载并拼接当前环境中的 MEMORY.md 内容。 */
export async function loadMemory(options: MemoryOptions = {}): Promise<LoadedMemory | undefined> {
  const discoveredFiles = discoverMemoryFiles(options);
  const files = [];

  for (const file of discoveredFiles) {
    if (!(await fileExists(file.path))) {
      continue;
    }
    files.push(file);
  }

  if (files.length === 0) {
    return undefined;
  }

  const parts: Array<{scope: 'global' | 'project'; path: string; content: string}> = [];

  for (const file of files) {
    const content = (await readFile(file.path, 'utf8')).trim();
    if (!content) {
      continue;
    }
    parts.push({
      scope: file.scope,
      path: file.path,
      content,
    });
  }

  if (parts.length === 0) {
    return undefined;
  }

  return {
    files,
    content: formatMemory(parts, {maxChars: options.maxChars}),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

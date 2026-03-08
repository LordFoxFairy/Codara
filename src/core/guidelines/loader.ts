import {access, readFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {discoverGuidelineFiles} from '@core/guidelines/discovery';
import {formatGuidelines} from '@core/guidelines/format';
import type {GuidelinesOptions, LoadedGuidelines} from '@core/guidelines/types';

/** 加载并拼接当前环境中的 AGENTS.md 规范。 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const discoveredFiles = discoverGuidelineFiles(options);
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
    content: formatGuidelines(parts),
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

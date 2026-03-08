import {discoverGuidelineFiles} from '@core/middleware/guidelines/discovery';
import {formatGuidelines} from '@core/middleware/guidelines/format';
import type {GuidelinesOptions, LoadedGuidelines} from '@core/middleware/guidelines/types';
import {loadWorkspaceFiles} from '@core/workspace';

/** 加载并拼接当前环境中的 AGENTS.md 规范。 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const files = await loadWorkspaceFiles(discoverGuidelineFiles(options));

  if (files.length === 0) {
    return undefined;
  }

  return {
    files,
    content: formatGuidelines(files),
  };
}

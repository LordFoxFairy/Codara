import type {GuidelineFile, GuidelinesOptions} from '@core/middleware/guidelines/types';
import {discoverWorkspaceFiles} from '@core/workspace';

const AGENTS_FILE_NAME = 'AGENTS.md';

/** 发现当前环境中可用的 AGENTS.md 规范文件。 */
export function discoverGuidelineFiles(options: GuidelinesOptions = {}): GuidelineFile[] {
  return discoverWorkspaceFiles(AGENTS_FILE_NAME, options);
}

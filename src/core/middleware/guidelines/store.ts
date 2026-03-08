import {discoverGuidelineFiles} from '@core/middleware/guidelines/discovery';
import {formatGuidelines} from '@core/middleware/guidelines/format';
import type {GuidelinesOptions, LoadedGuidelines} from '@core/middleware/guidelines/types';
import {loadWorkspaceFiles} from '@core/workspace';

/** Guidelines Store 接口，仅供内部使用。 */
export interface GuidelinesStore {
  /** 加载并拼接当前环境中的 AGENTS.md 规范。 */
  load(): Promise<LoadedGuidelines | undefined>;
}

/** 创建 Guidelines Store 实例。 */
export function createGuidelinesStore(options: GuidelinesOptions = {}): GuidelinesStore {
  return {
    async load() {
      const files = await loadWorkspaceFiles(discoverGuidelineFiles(options));

      if (files.length === 0) {
        return undefined;
      }

      return {
        files,
        content: formatGuidelines(files),
      };
    },
  };
}

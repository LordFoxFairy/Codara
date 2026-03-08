import {homedir} from 'node:os';
import path from 'node:path';
import type {AgentsGuidelineFile, AgentsGuidelinesOptions} from '@core/guidelines/types';
import {resolveWorkspaceRoot} from '@core/workspace';

const AGENTS_FILE_NAME = 'AGENTS.md';

/** 发现当前环境中可用的 AGENTS.md 规范文件。 */
export function discoverAgentsGuidelineFiles(options: AgentsGuidelinesOptions = {}): AgentsGuidelineFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', AGENTS_FILE_NAME),
    },
    {
      scope: 'project',
      path: path.join(projectRoot, AGENTS_FILE_NAME),
    },
  ];
}

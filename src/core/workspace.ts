import {existsSync} from 'node:fs';
import path from 'node:path';

const DEFAULT_WORKSPACE_MARKERS = ['.codara', '.git', 'package.json'] as const;

export interface WorkspaceRootOptions {
  cwd?: string;
  projectRoot?: string;
}

/** 解析当前工作区根目录，优先使用显式 projectRoot，其次从 cwd 向上查找标记文件。 */
export function resolveWorkspaceRoot(options: WorkspaceRootOptions = {}): string {
  if (options.projectRoot) {
    return path.resolve(options.projectRoot);
  }

  let current = path.resolve(options.cwd ?? process.cwd());

  while (true) {
    if (DEFAULT_WORKSPACE_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(options.cwd ?? process.cwd());
    }
    current = parent;
  }
}

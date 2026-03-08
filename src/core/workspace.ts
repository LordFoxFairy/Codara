import {constants as fsConstants, existsSync} from 'node:fs';
import {access, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const DEFAULT_WORKSPACE_MARKERS = ['.codara', '.git', 'package.json'] as const;

export interface WorkspaceRootOptions {
  cwd?: string;
  projectRoot?: string;
}

export interface WorkspaceFileOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export interface WorkspaceScopedFile {
  scope: 'global' | 'project';
  path: string;
}

export interface LoadedWorkspaceFile extends WorkspaceScopedFile {
  content: string;
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

/** 发现全局和项目作用域下的标准文件。 */
export function discoverWorkspaceFiles(fileName: string, options: WorkspaceFileOptions = {}): WorkspaceScopedFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', fileName),
    },
    {
      scope: 'project',
      path: path.join(projectRoot, fileName),
    },
  ];
}

/** 加载可读且非空的作用域文件内容。 */
export async function loadWorkspaceFiles(files: WorkspaceScopedFile[]): Promise<LoadedWorkspaceFile[]> {
  const loaded: LoadedWorkspaceFile[] = [];

  for (const file of files) {
    if (!(await isReadableFile(file.path))) {
      continue;
    }

    const content = (await readFile(file.path, 'utf8')).trim();
    if (!content) {
      continue;
    }

    loaded.push({
      scope: file.scope,
      path: file.path,
      content,
    });
  }

  return loaded;
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

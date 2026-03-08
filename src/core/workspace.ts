import {constants as fsConstants, existsSync} from 'node:fs';
import {access, readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const DEFAULT_WORKSPACE_MARKERS = ['.codara', '.git', 'package.json'] as const;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const WARN_FILE_SIZE = 1 * 1024 * 1024; // 1MB

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

export interface LoadWorkspaceFilesOptions {
  /** 最大文件大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 警告文件大小（字节），默认 1MB */
  warnFileSize?: number;
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
export function discoverWorkspaceFiles(
  fileName: string,
  options: WorkspaceFileOptions = {},
  projectSubdir?: string
): WorkspaceScopedFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', fileName),
    },
    {
      scope: 'project',
      path: projectSubdir
        ? path.join(projectRoot, projectSubdir, fileName)
        : path.join(projectRoot, fileName),
    },
  ];
}

/** 加载可读且非空的作用域文件内容。 */
export async function loadWorkspaceFiles(
  files: WorkspaceScopedFile[],
  options: LoadWorkspaceFilesOptions = {}
): Promise<LoadedWorkspaceFile[]> {
  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE;
  const warnFileSize = options.warnFileSize ?? WARN_FILE_SIZE;
  const loaded: LoadedWorkspaceFile[] = [];

  for (const file of files) {
    if (!(await isReadableFile(file.path))) {
      continue;
    }

    // 检查文件大小
    let fileSize: number;
    try {
      const stats = await stat(file.path);
      fileSize = stats.size;
    } catch {
      continue;
    }

    // 超过最大限制，跳过
    if (fileSize > maxFileSize) {
      console.warn(
        `[Codara] Skipping ${file.path}: file size ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds limit ${(maxFileSize / 1024 / 1024).toFixed(2)}MB`
      );
      continue;
    }

    // 超过警告阈值，警告但继续加载
    if (fileSize > warnFileSize) {
      console.warn(
        `[Codara] Large file detected: ${file.path} (${(fileSize / 1024 / 1024).toFixed(2)}MB). Consider splitting into smaller files.`
      );
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

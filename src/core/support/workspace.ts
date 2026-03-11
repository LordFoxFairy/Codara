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
  truncated?: boolean;
}

export interface LoadWorkspaceFilesOptions {
  /** 最大文件大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 警告文件大小（字节），默认 1MB */
  warnFileSize?: number;
  /** 最多加载的行数，超出时截断。 */
  maxLines?: number;
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

/** 发现全局和从 projectRoot 到 cwd 的层级文件。 */
export function discoverHierarchicalWorkspaceFiles(
  fileName: string,
  options: WorkspaceFileOptions = {},
  projectSubdir?: string
): WorkspaceScopedFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const projectFiles: WorkspaceScopedFile[] = [];
  let current = cwd;

  while (true) {
    projectFiles.push({
      scope: 'project',
      path: projectSubdir
        ? path.join(current, projectSubdir, fileName)
        : path.join(current, fileName),
    });

    if (current === projectRoot) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return [
    {
      scope: 'global',
      path: path.join(userHome, '.codara', fileName),
    },
    ...projectFiles.reverse(),
  ];
}

/** 加载可读且非空的作用域文件内容。 */
export async function loadWorkspaceFiles(
  files: WorkspaceScopedFile[],
  options: LoadWorkspaceFilesOptions = {}
): Promise<LoadedWorkspaceFile[]> {
  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE;
  const warnFileSize = options.warnFileSize ?? WARN_FILE_SIZE;
  const maxLines = options.maxLines;
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

    const content = truncateByLines((await readFile(file.path, 'utf8')).trim(), maxLines);
    if (!content) {
      continue;
    }

    loaded.push({
      scope: file.scope,
      path: file.path,
      content: content.value,
      truncated: content.truncated,
    });
  }

  return loaded;
}

/** 加载支持简单 @import 的 instruction 文件。 */
export async function loadInstructionFiles(
  files: WorkspaceScopedFile[],
  options: LoadWorkspaceFilesOptions = {}
): Promise<LoadedWorkspaceFile[]> {
  const loaded: LoadedWorkspaceFile[] = [];

  for (const file of files) {
    const content = await readWorkspaceInstructionFile(file.path, options, new Set<string>());
    if (!content) {
      continue;
    }

    loaded.push({
      scope: file.scope,
      path: file.path,
      content: content.value,
      truncated: content.truncated,
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

function truncateByLines(content: string, maxLines?: number): {value: string; truncated: boolean} {
  if (!maxLines || maxLines <= 0) {
    return {value: content, truncated: false};
  }

  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return {value: content, truncated: false};
  }

  return {
    value: lines.slice(0, maxLines).join('\n'),
    truncated: true,
  };
}

async function readWorkspaceInstructionFile(
  filePath: string,
  options: LoadWorkspaceFilesOptions,
  visited: Set<string>,
): Promise<{value: string; truncated: boolean} | undefined> {
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath) || !(await isReadableFile(resolvedPath))) {
    return undefined;
  }

  visited.add(resolvedPath);

  const maxFileSize = options.maxFileSize ?? MAX_FILE_SIZE;
  const warnFileSize = options.warnFileSize ?? WARN_FILE_SIZE;

  let fileSize: number;
  try {
    const stats = await stat(resolvedPath);
    fileSize = stats.size;
  } catch {
    return undefined;
  }

  if (fileSize > maxFileSize) {
    console.warn(
      `[Codara] Skipping ${resolvedPath}: file size ${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds limit ${(maxFileSize / 1024 / 1024).toFixed(2)}MB`
    );
    return undefined;
  }

  if (fileSize > warnFileSize) {
    console.warn(
      `[Codara] Large file detected: ${resolvedPath} (${(fileSize / 1024 / 1024).toFixed(2)}MB). Consider splitting into smaller files.`
    );
  }

  const raw = (await readFile(resolvedPath, 'utf8')).trim();
  if (!raw) {
    return undefined;
  }

  const expanded = await expandInstructionImports(raw, path.dirname(resolvedPath), options, visited);
  return truncateByLines(expanded.trim(), options.maxLines);
}

async function expandInstructionImports(
  content: string,
  baseDir: string,
  options: LoadWorkspaceFilesOptions,
  visited: Set<string>,
): Promise<string> {
  const lines = content.split('\n');
  const expanded: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      expanded.push(line);
      continue;
    }

    if (!inFence && trimmed.startsWith('@') && trimmed.length > 1) {
      const importTarget = trimmed.slice(1).trim();
      const imported = await readWorkspaceInstructionFile(
        path.isAbsolute(importTarget) ? importTarget : path.resolve(baseDir, importTarget),
        options,
        visited,
      );
      if (imported?.value) {
        expanded.push(imported.value);
        continue;
      }
    }

    expanded.push(line);
  }

  return expanded.join('\n');
}

import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/shared/workspace';
import {resolveWorkspaceRoot} from '@core/shared/workspace';

export interface InstructionPathTarget {
  path: string;
  kind?: 'file' | 'directory';
}

export interface ProgressiveInstructionSource {
  getContent(): Promise<string | undefined>;
  getBootstrapContent(): Promise<string | undefined>;
  getProgressiveContent(): Promise<string | undefined>;
  reload(): void;
  activateTarget(target: InstructionPathTarget): Promise<boolean>;
}

export interface ProgressiveInstructionSourceOptions extends WorkspaceRootOptions {
  userHome?: string;
  title: string;
  lead: string;
  globalFileName?: string;
  projectFileResolver(directory: string): string;
  blockTitle(filePath: string): string;
  maxImportDepth?: number;
}

export class SessionScopedProgressiveInstructionSource implements ProgressiveInstructionSource {
  private readonly userHome: string;
  private readonly projectRoot: string;
  private readonly cwd: string;
  private readonly startupFiles: string[];
  private readonly activatedFiles = new Set<string>();
  private readonly fileCache = new Map<string, string | null>();
  private renderedCaches = new Map<string, {key: string; content?: string}>();

  constructor(private readonly options: ProgressiveInstructionSourceOptions) {
    this.userHome = path.resolve(options.userHome ?? homedir());
    this.projectRoot = resolveWorkspaceRoot(options);
    this.cwd = path.resolve(options.cwd ?? this.projectRoot);
    this.startupFiles = discoverStartupFiles({
      userHome: this.userHome,
      projectRoot: this.projectRoot,
      cwd: this.cwd,
      globalFileName: options.globalFileName,
      projectFileResolver: options.projectFileResolver,
    });
  }

  async getContent(): Promise<string | undefined> {
    return this.renderProjection('all', this.listFilePaths());
  }

  async getBootstrapContent(): Promise<string | undefined> {
    return this.renderProjection('bootstrap', this.startupFiles);
  }

  async getProgressiveContent(): Promise<string | undefined> {
    return this.renderProjection('progressive', sortProjectFiles([...this.activatedFiles], this.projectRoot));
  }

  reload(): void {
    this.activatedFiles.clear();
    this.fileCache.clear();
    this.renderedCaches.clear();
  }

  async activateTarget(target: InstructionPathTarget): Promise<boolean> {
    const targetDirectory = resolveTargetDirectory(target, this.cwd);
    if (!isInsideProjectRoot(this.projectRoot, targetDirectory)) {
      return false;
    }

    let changed = false;
    for (const filePath of discoverProjectFiles(targetDirectory, this.projectRoot, this.options.projectFileResolver)) {
      if (this.startupFiles.includes(filePath) || this.activatedFiles.has(filePath)) {
        continue;
      }
      this.activatedFiles.add(filePath);
      changed = true;
    }

    if (!changed) {
      return false;
    }

    await this.primeFiles(this.listFilePaths());
    this.renderedCaches.clear();
    return true;
  }

  private listFilePaths(): string[] {
    return [
      ...this.startupFiles,
      ...sortProjectFiles([...this.activatedFiles], this.projectRoot),
    ];
  }

  private async primeFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      if (this.fileCache.has(filePath)) {
        continue;
      }
      this.fileCache.set(filePath, await loadInstructionFile(filePath, this.options.maxImportDepth ?? 5));
    }
  }

  private async renderProjection(cacheName: string, filePaths: string[]): Promise<string | undefined> {
    await this.primeFiles(filePaths);
    const files = filePaths
      .map((filePath) => {
        const content = this.fileCache.get(filePath);
        return content ? {filePath, content} : undefined;
      })
      .filter((entry): entry is {filePath: string; content: string} => Boolean(entry));

    const cacheKey = files.map((entry) => `${entry.filePath}:${entry.content.length}`).join('\0');
    const cached = this.renderedCaches.get(cacheName);
    if (cached?.key === cacheKey) {
      return cached.content;
    }

    if (files.length === 0) {
      this.renderedCaches.set(cacheName, {key: cacheKey, content: undefined});
      return undefined;
    }

    const blocks: string[] = [];
    for (const file of files) {
      if (blocks.length > 0) {
        blocks.push('');
      }
      blocks.push(`## ${this.options.blockTitle(file.filePath)}`);
      blocks.push(`Path: ${file.filePath}`);
      blocks.push('');
      blocks.push(file.content);
    }

    const content = [
      this.options.title,
      '',
      this.options.lead,
      '',
      ...blocks,
    ].join('\n');

    this.renderedCaches.set(cacheName, {key: cacheKey, content});
    return content;
  }
}

async function loadInstructionFile(filePath: string, maxImportDepth: number): Promise<string | null> {
  const absolutePath = path.resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return expandImports(absolutePath, trimmed, maxImportDepth, new Set<string>([absolutePath]));
}

async function expandImports(
  ownerFilePath: string,
  content: string,
  maxImportDepth: number,
  visited: Set<string>,
  depth = 0,
): Promise<string> {
  if (depth >= maxImportDepth) {
    return content;
  }

  const output: string[] = [];
  for (const line of content.split('\n')) {
    const importPath = parseImportPath(line);
    if (!importPath) {
      output.push(line);
      continue;
    }

    const resolved = resolveImportPath(ownerFilePath, importPath);
    if (!resolved || visited.has(resolved)) {
      output.push(line);
      continue;
    }

    let importedRaw: string;
    try {
      importedRaw = await readFile(resolved, 'utf8');
    } catch {
      output.push(line);
      continue;
    }

    const imported = importedRaw.trim();
    if (!imported) {
      continue;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(resolved);
    output.push(`> Imported from ${resolved}`);
    output.push(await expandImports(resolved, imported, maxImportDepth, nextVisited, depth + 1));
  }

  return output.join('\n').trim();
}

function parseImportPath(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@') || trimmed.length <= 1) {
    return undefined;
  }

  const spec = trimmed.slice(1).trim();
  return spec.length > 0 ? spec : undefined;
}

function resolveImportPath(ownerFilePath: string, spec: string): string | undefined {
  if (spec.startsWith('/')) {
    return path.resolve(spec);
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return path.resolve(path.dirname(ownerFilePath), spec);
  }
  return undefined;
}

function discoverStartupFiles(input: {
  userHome: string;
  projectRoot: string;
  cwd: string;
  globalFileName?: string;
  projectFileResolver(directory: string): string;
}): string[] {
  const files: string[] = [];
  if (input.globalFileName) {
    files.push(path.join(input.userHome, '.codara', input.globalFileName));
  }
  files.push(...discoverProjectFiles(input.cwd, input.projectRoot, input.projectFileResolver));
  return uniqueResolvedPaths(files);
}

function discoverProjectFiles(
  targetDirectory: string,
  projectRoot: string,
  projectFileResolver: (directory: string) => string,
): string[] {
  const files: string[] = [];
  let current = path.resolve(targetDirectory);
  const root = path.resolve(projectRoot);

  while (true) {
    files.push(projectFileResolver(current));
    if (current === root) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return files.reverse();
}

function resolveTargetDirectory(target: InstructionPathTarget, cwd: string): string {
  const resolvedPath = path.resolve(cwd, target.path);
  return target.kind === 'directory' ? resolvedPath : path.dirname(resolvedPath);
}

function sortProjectFiles(files: string[], projectRoot: string): string[] {
  const root = path.resolve(projectRoot);
  return [...files].sort((left, right) => {
    const leftDepth = path.relative(root, path.dirname(left)).split(path.sep).filter(Boolean).length;
    const rightDepth = path.relative(root, path.dirname(right)).split(path.sep).filter(Boolean).length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    return left.localeCompare(right);
  });
}

function uniqueResolvedPaths(filePaths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    unique.push(resolved);
  }
  return unique;
}

function isInsideProjectRoot(projectRoot: string, targetDirectory: string): boolean {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(targetDirectory));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

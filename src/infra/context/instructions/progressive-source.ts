import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@infra/config/workspace';
import {resolveWorkspaceRoot} from '@infra/config/workspace';

export interface ProgressiveInstructionWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export interface ProgressiveInstructionSource {
  getContent(): Promise<string | undefined>;
  reload(): void;
}

export interface ProgressiveInstructionSourceOptions extends ProgressiveInstructionWorkspaceOptions {
  title: string;
  lead: string;
  globalFileName?: string;
  userProjectFiles?: string[];
  projectFileResolver(directory: string): string;
  blockTitle(filePath: string): string;
  maxImportDepth?: number;
}

export class SessionScopedProgressiveInstructionSource implements ProgressiveInstructionSource {
  private readonly userHome: string;
  private readonly startupFiles: string[];
  private readonly fileCache = new Map<string, string | null>();
  private renderedCache?: {key: string; content?: string};

  constructor(private readonly options: ProgressiveInstructionSourceOptions) {
    this.userHome = path.resolve(options.userHome ?? homedir());
    const projectRoot = resolveWorkspaceRoot(options);
    const cwd = path.resolve(options.cwd ?? projectRoot);
    this.startupFiles = discoverStartupFiles({
      userHome: this.userHome,
      projectRoot,
      cwd,
      globalFileName: options.globalFileName,
      userProjectFiles: options.userProjectFiles,
      projectFileResolver: options.projectFileResolver,
    });
  }

  async getContent(): Promise<string | undefined> {
    return this.renderProjection(this.startupFiles);
  }

  reload(): void {
    this.fileCache.clear();
    this.renderedCache = undefined;
  }

  private async primeFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.loadFile(filePath);
    }
  }

  private async loadFile(filePath: string): Promise<string | null> {
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath) ?? null;
    }

    const loaded = await loadInstructionFile(filePath, this.options.maxImportDepth ?? 5);
    this.fileCache.set(filePath, loaded);
    return loaded;
  }

  private async renderProjection(filePaths: string[]): Promise<string | undefined> {
    await this.primeFiles(filePaths);
    const files = filePaths
      .map((filePath) => {
        const content = this.fileCache.get(filePath);
        return content ? {filePath, content} : undefined;
      })
      .filter((entry): entry is {filePath: string; content: string} => Boolean(entry));

    const cacheKey = files.map((entry) => `${entry.filePath}:${entry.content.length}`).join('\0');
    if (this.renderedCache?.key === cacheKey) {
      return this.renderedCache.content;
    }

    if (files.length === 0) {
      this.renderedCache = {key: cacheKey, content: undefined};
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

    this.renderedCache = {key: cacheKey, content};
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
  userProjectFiles?: string[];
  projectFileResolver(directory: string): string;
}): string[] {
  const files: string[] = [];
  if (input.globalFileName) {
    files.push(path.join(input.userHome, '.codara', input.globalFileName));
  }
  if (input.userProjectFiles) {
    files.push(...input.userProjectFiles);
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

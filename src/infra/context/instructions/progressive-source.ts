import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@infra/config/workspace';
import {resolveWorkspaceRoot} from '@infra/config/workspace';

export interface ProgressiveInstructionWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export interface ProgressiveInstructionSource {
  /** Init: load root-level files (global + user-project + project root). */
  getContent(): Promise<string | undefined>;
  /** Agent loop: resolve nearby instruction files for a given file path. Returns new files not yet in systemPaths. */
  resolve(filePath: string): Promise<string | undefined>;
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
  private readonly projectRoot: string;
  private readonly startupFiles: string[];
  private readonly fileCache = new Map<string, string | null>();
  private renderedCache?: {key: string; content?: string};
  /** Track which files have been injected (init + resolve) to prevent duplicates. */
  private readonly injectedFiles = new Set<string>();

  constructor(private readonly options: ProgressiveInstructionSourceOptions) {
    this.userHome = path.resolve(options.userHome ?? homedir());
    this.projectRoot = resolveWorkspaceRoot(options);
    // Init: only global + user-project + project root (no subdirectory walk)
    this.startupFiles = discoverRootFiles({
      userHome: this.userHome,
      projectRoot: this.projectRoot,
      globalFileName: options.globalFileName,
      userProjectFiles: options.userProjectFiles,
      projectFileResolver: options.projectFileResolver,
    });
  }

  async getContent(): Promise<string | undefined> {
    const rendered = await this.renderProjection(this.startupFiles);
    // Mark startup files as injected
    for (const filePath of this.startupFiles) {
      this.injectedFiles.add(path.resolve(filePath));
    }
    return rendered;
  }

  async resolve(filePath: string): Promise<string | undefined> {
    const targetDir = path.dirname(path.resolve(filePath));
    const candidates = discoverAncestorFiles(
      targetDir,
      this.projectRoot,
      this.options.projectFileResolver,
    );

    // Filter out already-injected files
    const newFiles = candidates.filter((f) => !this.injectedFiles.has(path.resolve(f)));
    if (newFiles.length === 0) {
      return undefined;
    }

    // Load and render new files
    const blocks: string[] = [];
    for (const file of newFiles) {
      const content = await this.loadFile(file);
      if (!content) continue;

      this.injectedFiles.add(path.resolve(file));
      blocks.push(`Instructions from: ${file}`);
      blocks.push(content);
    }

    return blocks.length > 0 ? blocks.join('\n') : undefined;
  }

  reload(): void {
    this.fileCache.clear();
    this.renderedCache = undefined;
    this.injectedFiles.clear();
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
    for (const filePath of filePaths) {
      await this.loadFile(filePath);
    }

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

// ── File loading ──────────────────────────────────────────────────────

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

// ── Discovery ──────────────────────────────────────────────────────────

/**
 * Init discovery: global + user-project + project ROOT only.
 * No subdirectory walk — those are resolved lazily during agent loop.
 */
function discoverRootFiles(input: {
  userHome: string;
  projectRoot: string;
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
  // Only project root, not subdirectory walk
  files.push(input.projectFileResolver(input.projectRoot));
  return uniqueResolvedPaths(files);
}

/**
 * Lazy discovery: walk from targetDir up to projectRoot,
 * collecting instruction files at each level.
 * Returns files from root to target (natural reading order).
 */
function discoverAncestorFiles(
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

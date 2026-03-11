import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/support/workspace';
import {
  discoverHierarchicalWorkspaceFiles,
  loadInstructionFiles,
  resolveWorkspaceRoot,
} from '@core/support/workspace';

const DEFAULT_LINES = 500;

export type AgentsFileScope = 'global' | 'project';
export type GuidelineFile = WorkspaceScopedFile;

export interface AgentsFileStackEntry extends WorkspaceScopedFile {
  loaded: boolean;
}

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

export interface GuidelinesOptions extends WorkspaceFileOptions {
  maxLines?: number;
}

export interface AgentsFileOverview {
  globalPath: string;
  projectPath: string;
  loadedPaths: string[];
  stack: AgentsFileStackEntry[];
}

export interface AgentsFileOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
}

export interface GuidelinesSource {
  getContent(): Promise<string | undefined>;
  reload(): void;
  inspectFiles?(): Promise<AgentsFileOverview>;
  ensureFileTarget?(scope: AgentsFileScope): Promise<string>;
}

export interface FileGuidelinesSourceOptions {
  load: () => Promise<string | undefined>;
  cacheTTL?: number;
}

interface CacheEntry {
  content?: string;
  timestamp: number;
}

/**
 * Single AGENTS lifecycle module.
 *
 * It owns:
 * - hierarchical AGENTS.md discovery
 * - content projection loading
 * - host-level file inspection / ensure helpers
 * - source-instance scoped cached reads
 */
export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const maxLines = options.maxLines ?? DEFAULT_LINES;
  const userHome = options.userHome ?? homedir();
  const loadedFiles = await loadInstructionFiles(
    discoverHierarchicalWorkspaceFiles('AGENTS.md', {
      cwd: options.cwd,
      projectRoot: options.projectRoot,
      userHome,
    }),
    {maxLines},
  );

  if (loadedFiles.length === 0) {
    return undefined;
  }

  return {
    files: loadedFiles.map(({scope, path: filePath}) => ({scope, path: filePath})),
    content: [
      '# AGENTS Guidelines',
      '',
      'Loaded from the configured source stack. Read the source files directly if more detail is required.',
      '',
      ...loadedFiles.flatMap((file, index) => {
        const label = file.scope === 'global' ? 'Global AGENTS.md' : 'Project AGENTS.md';
        const lines = [`## ${label}`, `Path: ${file.path}`];

        if (file.content.length > 0) {
          lines.push('', ...file.content.split('\n'));
        }
        if (file.truncated) {
          lines.push('', `Truncated after ${maxLines} lines. Read the file directly for full content.`);
        }

        return index === 0 ? lines : ['', ...lines];
      }),
    ].join('\n'),
  };
}

export async function inspectAgentsFiles(
  options: AgentsFileOptions = {},
): Promise<AgentsFileOverview> {
  const discovered = discoverHierarchicalWorkspaceFiles('AGENTS.md', {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome ?? homedir(),
  });
  const {globalPath, projectPath} = resolveAgentsFileTargets(options, discovered);
  const loaded = options.guidelines === false
    ? undefined
    : await loadGuidelines(resolveGuidelinesOptions(options));
  const loadedPaths = loaded?.files.map((file) => file.path) ?? [];

  return {
    globalPath,
    projectPath,
    loadedPaths,
    stack: discovered.map((file) => ({
      ...file,
      loaded: loadedPaths.includes(file.path),
    })),
  };
}

export async function ensureAgentsFileTarget(
  options: AgentsFileOptions = {},
  scope: AgentsFileScope = 'project',
): Promise<string> {
  const {globalPath, projectPath} = resolveAgentsFileTargets(options);
  const target = scope === 'global' ? globalPath : projectPath;

  await mkdir(path.dirname(target), {recursive: true});
  try {
    await writeFile(target, '', {encoding: 'utf8', flag: 'ax'});
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      throw error;
    }
  }

  return target;
}

export class FileGuidelinesSource implements GuidelinesSource {
  private readonly load: () => Promise<string | undefined>;
  private readonly cacheTTL?: number;
  private readonly options: AgentsFileOptions;
  private cache?: CacheEntry;

  constructor(options: FileGuidelinesSourceOptions & {files?: AgentsFileOptions}) {
    this.load = options.load;
    this.cacheTTL = typeof options.cacheTTL === 'number' ? options.cacheTTL : undefined;
    this.options = options.files ?? {};
  }

  async getContent(): Promise<string | undefined> {
    const cached = this.cache;
    const now = Date.now();

    if (cached && (this.cacheTTL === undefined || now - cached.timestamp < this.cacheTTL)) {
      return cached.content;
    }

    const content = await this.load();
    this.cache = {content, timestamp: now};
    return content;
  }

  reload(): void {
    this.cache = undefined;
  }

  inspectFiles(): Promise<AgentsFileOverview> {
    return inspectAgentsFiles(this.options);
  }

  ensureFileTarget(scope: AgentsFileScope): Promise<string> {
    return ensureAgentsFileTarget(this.options, scope);
  }
}

export interface CodaraGuidelinesSourceOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
  cacheTTL?: number;
}

export function createCodaraGuidelinesSource(options: CodaraGuidelinesSourceOptions = {}): GuidelinesSource | undefined {
  if (options.guidelines === false) {
    return undefined;
  }

  return new FileGuidelinesSource({
    load: async () => {
      const loaded = await loadGuidelines(resolveGuidelinesOptions(options));
      return loaded?.content;
    },
    files: options,
    ...(typeof options.cacheTTL === 'number' ? {cacheTTL: options.cacheTTL} : {}),
  });
}

function resolveAgentsFileTargets(options: AgentsFileOptions): {
  globalPath: string;
  projectPath: string;
}
function resolveAgentsFileTargets(
  options: AgentsFileOptions,
  discovered: WorkspaceScopedFile[],
): {
  globalPath: string;
  projectPath: string;
}
function resolveAgentsFileTargets(
  options: AgentsFileOptions,
  discovered?: WorkspaceScopedFile[],
): {
  globalPath: string;
  projectPath: string;
} {
  const resolved = discovered ?? discoverHierarchicalWorkspaceFiles('AGENTS.md', {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome ?? homedir(),
  });
  const globalPath = resolved[0]?.path ?? path.join(options.userHome ?? homedir(), '.codara', 'AGENTS.md');
  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const projectPath = resolved.at(-1)?.path ?? path.join(projectRoot, 'AGENTS.md');

  return {globalPath, projectPath};
}

function resolveGuidelinesOptions(
  options: AgentsFileOptions | CodaraGuidelinesSourceOptions,
): GuidelinesOptions {
  const guidelines = isGuidelinesOptions(options.guidelines) ? options.guidelines : undefined;

  return {
    ...(options.cwd ? {cwd: options.cwd} : {}),
    ...(options.projectRoot ? {projectRoot: options.projectRoot} : {}),
    ...(options.userHome ? {userHome: options.userHome} : {}),
    ...(guidelines?.cwd ? {cwd: guidelines.cwd} : {}),
    ...(guidelines?.projectRoot ? {projectRoot: guidelines.projectRoot} : {}),
    ...(guidelines?.userHome ? {userHome: guidelines.userHome} : {}),
    ...(typeof guidelines?.maxLines === 'number' ? {maxLines: guidelines.maxLines} : {}),
  };
}

function isGuidelinesOptions(value: boolean | GuidelinesOptions | undefined): value is GuidelinesOptions {
  return Boolean(value && typeof value === 'object');
}

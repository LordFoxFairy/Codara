import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceFileOptions, WorkspaceScopedFile} from '@core/workspace';
import {
  discoverHierarchicalWorkspaceFiles,
  loadInstructionFiles,
  resolveWorkspaceRoot,
} from '@core/workspace';

const DEFAULT_LINES = 500;

export type AgentsFileScope = 'global' | 'project';
export type GuidelineFile = WorkspaceScopedFile;

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
}

export interface AgentsFileOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
}

export interface AgentsSource {
  getContent(): Promise<string | undefined>;
  reload(): void;
  inspectFiles?(): Promise<AgentsFileOverview>;
  ensureFileTarget?(scope: AgentsFileScope): Promise<string>;
}

export interface FileAgentsSourceOptions {
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
 * - session-scoped cached source reads
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
  const {globalPath, projectPath} = resolveAgentsFileTargets(options);
  const loaded = options.guidelines === false
    ? undefined
    : await loadGuidelines(resolveGuidelinesOptions(options));

  return {
    globalPath,
    projectPath,
    loadedPaths: loaded?.files.map((file) => file.path) ?? [],
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

export class FileAgentsSource implements AgentsSource {
  private readonly load: () => Promise<string | undefined>;
  private readonly cacheTTL?: number;
  private readonly options: AgentsFileOptions;
  private cache?: CacheEntry;

  constructor(options: FileAgentsSourceOptions & {files?: AgentsFileOptions}) {
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

export interface CodaraAgentsSourceOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
  cacheTTL?: number;
}

export function createCodaraAgentsSource(options: CodaraAgentsSourceOptions = {}): AgentsSource | undefined {
  if (options.guidelines === false) {
    return undefined;
  }

  return new FileAgentsSource({
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
} {
  const discovered = discoverHierarchicalWorkspaceFiles('AGENTS.md', {
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome ?? homedir(),
  });
  const globalPath = discovered[0]?.path ?? path.join(options.userHome ?? homedir(), '.codara', 'AGENTS.md');
  const projectRoot = resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
  const projectPath = discovered.at(-1)?.path ?? path.join(projectRoot, 'AGENTS.md');

  return {globalPath, projectPath};
}

function resolveGuidelinesOptions(
  options: AgentsFileOptions | CodaraAgentsSourceOptions,
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

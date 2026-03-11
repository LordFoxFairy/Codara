import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/shared/workspace';
import {resolveWorkspaceRoot} from '@core/shared/workspace';

const DEFAULT_LINES = 200;
const AGENTS_FILE_NAME = 'AGENTS.md';
export type GuidelineFile = WorkspaceScopedFile;

export interface WorkspaceFileOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export interface WorkspaceScopedFile {
  scope: 'global' | 'project';
  path: string;
}

interface LoadedWorkspaceFile extends WorkspaceScopedFile {
  content: string;
  truncated: boolean;
}

export interface LoadedGuidelines {
  files: GuidelineFile[];
  content: string;
}

export interface GuidelinesOptions extends WorkspaceFileOptions {
  maxLines?: number;
}

export interface GuidelinesSource {
  getContent(): Promise<string | undefined>;
}

export interface FileGuidelinesSourceOptions {
  load: () => Promise<string | undefined>;
}

export interface CodaraGuidelinesSourceOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
}

interface ResolvedGuidelinesOptions extends WorkspaceFileOptions {
  maxLines: number;
}

export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const settings = resolveGuidelinesOptions(options);
  const loadedFiles = await loadGuidelineFiles(discoverGuidelineFiles(settings), settings.maxLines);
  if (loadedFiles.length === 0) {
    return undefined;
  }

  return {
    files: loadedFiles.map(({scope, path: filePath}) => ({scope, path: filePath})),
    content: formatGuidelineContent(loadedFiles, settings.maxLines),
  };
}

export class FileGuidelinesSource implements GuidelinesSource {
  constructor(private readonly options: FileGuidelinesSourceOptions) {}

  getContent(): Promise<string | undefined> {
    return this.options.load();
  }
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
  });
}

function discoverGuidelineFiles(options: WorkspaceFileOptions): WorkspaceScopedFile[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const projectFiles: WorkspaceScopedFile[] = [];
  let current = cwd;

  while (true) {
    projectFiles.push({
      scope: 'project',
      path: path.join(current, AGENTS_FILE_NAME),
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
    {scope: 'global', path: path.join(userHome, '.codara', AGENTS_FILE_NAME)},
    ...projectFiles.reverse(),
  ];
}

async function loadGuidelineFiles(
  files: WorkspaceScopedFile[],
  maxLines: number,
): Promise<LoadedWorkspaceFile[]> {
  const loaded: LoadedWorkspaceFile[] = [];

  for (const file of files) {
    const content = await readGuidelineFile(file.path, maxLines);
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

async function readGuidelineFile(
  filePath: string,
  maxLines: number,
): Promise<{value: string; truncated: boolean} | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const lines = trimmed.split('\n');
  if (lines.length <= maxLines) {
    return {value: trimmed, truncated: false};
  }

  return {
    value: lines.slice(0, maxLines).join('\n'),
    truncated: true,
  };
}

function formatGuidelineContent(files: LoadedWorkspaceFile[], maxLines: number): string {
  return [
    '# AGENTS Guidelines',
    '',
    'Loaded from the configured source stack. Read the source files directly if more detail is required.',
    '',
    ...files.flatMap((file, index) => {
      const label = file.scope === 'global' ? 'Global AGENTS.md' : 'Project AGENTS.md';
      const block = [
        `## ${label}`,
        `Path: ${file.path}`,
        '',
        file.content,
        ...(file.truncated ? ['', `Truncated after ${maxLines} lines. Read the file directly for full content.`] : []),
      ];

      return index === 0 ? block : ['', ...block];
    }),
  ].join('\n');
}

function resolveGuidelinesOptions(
  options: CodaraGuidelinesSourceOptions | GuidelinesOptions,
) : ResolvedGuidelinesOptions {
  const nested = readNestedGuidelinesOptions(options);
  return {
    cwd: nested?.cwd ?? options.cwd,
    projectRoot: nested?.projectRoot ?? options.projectRoot,
    userHome: nested?.userHome ?? options.userHome,
    maxLines: nested?.maxLines ?? ('maxLines' in options && typeof options.maxLines === 'number' ? options.maxLines : DEFAULT_LINES),
  };
}

function readNestedGuidelinesOptions(
  options: CodaraGuidelinesSourceOptions | GuidelinesOptions,
): GuidelinesOptions | undefined {
  if (!('guidelines' in options)) {
    return undefined;
  }

  const nested = options.guidelines;
  return isGuidelinesOptions(nested)
    ? nested
    : undefined;
}

function isGuidelinesOptions(value: boolean | GuidelinesOptions | undefined): value is GuidelinesOptions {
  return Boolean(value && typeof value === 'object');
}

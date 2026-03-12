import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/shared/workspace';
import {resolveWorkspaceRoot} from '@core/shared/workspace';

const DEFAULT_LINES = 200;
const AGENTS_FILE_NAME = 'AGENTS.md';

export interface GuidelinesWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export interface LoadedGuidelines {
  files: string[];
  content: string;
}

export interface GuidelinesOptions extends GuidelinesWorkspaceOptions {
  maxLines?: number;
}

export interface GuidelinesSource {
  getContent(): Promise<string | undefined>;
}

export interface FileGuidelinesSourceOptions {
  load: () => Promise<string | undefined>;
}

export interface CodaraGuidelinesSourceOptions extends GuidelinesWorkspaceOptions {
  guidelines?: boolean | GuidelinesOptions;
}

interface ResolvedGuidelinesOptions extends GuidelinesWorkspaceOptions {
  maxLines: number;
}

export async function loadGuidelines(options: GuidelinesOptions = {}): Promise<LoadedGuidelines | undefined> {
  const settings = resolveGuidelinesOptions(options);
  return buildLoadedGuidelines(discoverGuidelineFiles(settings), settings.maxLines);
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

function discoverGuidelineFiles(options: GuidelinesWorkspaceOptions): string[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const projectFiles: string[] = [];
  let current = cwd;

  while (true) {
    projectFiles.push(path.join(current, AGENTS_FILE_NAME));

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
    path.join(userHome, '.codara', AGENTS_FILE_NAME),
    ...projectFiles.reverse(),
  ];
}

async function loadGuidelineFiles(
  files: string[],
  maxLines: number,
): Promise<{files: string[]; blocks: string[]} | undefined> {
  const loadedFiles: string[] = [];
  const blocks: string[] = [];

  for (const filePath of files) {
    const content = await readGuidelineFile(filePath, maxLines);
    if (!content) {
      continue;
    }

    loadedFiles.push(filePath);
    blocks.push(...renderGuidelineBlock(filePath, content.value, content.truncated, maxLines, blocks.length > 0));
  }

  if (loadedFiles.length === 0) {
    return undefined;
  }

  return {files: loadedFiles, blocks};
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

async function buildLoadedGuidelines(
  files: string[],
  maxLines: number,
): Promise<LoadedGuidelines | undefined> {
  const loaded = await loadGuidelineFiles(files, maxLines);
  if (!loaded) {
    return undefined;
  }

  return {
    files: loaded.files,
    content: formatGuidelineContent(loaded.blocks),
  };
}

function formatGuidelineContent(blocks: string[]): string {
  return [
    '# AGENTS Guidelines',
    '',
    'Loaded from the workspace guideline stack. Read the files directly if more detail is required.',
    '',
    ...blocks,
  ].join('\n');
}

function renderGuidelineBlock(
  filePath: string,
  content: string,
  truncated: boolean,
  maxLines: number,
  addSeparator: boolean,
): string[] {
  return [
    ...(addSeparator ? [''] : []),
    '## AGENTS.md',
    `Path: ${filePath}`,
    '',
    content,
    ...(truncated ? ['', `Truncated after ${maxLines} lines. Read the file directly for full content.`] : []),
  ];
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

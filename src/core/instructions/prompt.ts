import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {WorkspaceRootOptions} from '@core/shared/workspace';
import {resolveWorkspaceRoot} from '@core/shared/workspace';

const PROMPT_FILE_NAME = 'prompt.md';

export interface PromptWorkspaceOptions extends WorkspaceRootOptions {
  userHome?: string;
}

export type PromptOptions = PromptWorkspaceOptions;

export interface PromptSource {
  getContent(): Promise<string | undefined>;
}

export interface FilePromptSourceOptions {
  load: () => Promise<string | undefined>;
}

export interface CodaraPromptSourceOptions extends PromptWorkspaceOptions {
  prompt?: boolean | PromptOptions;
}

export class FilePromptSource implements PromptSource {
  constructor(private readonly options: FilePromptSourceOptions) {}

  getContent(): Promise<string | undefined> {
    return this.options.load();
  }
}

export function createCodaraPromptSource(options: CodaraPromptSourceOptions = {}): PromptSource | undefined {
  if (options.prompt === false) {
    return undefined;
  }

  return new FilePromptSource({
    load: async () => {
      const promptFiles = discoverPromptFiles(resolvePromptOptions(options));
      return loadPromptFiles(promptFiles);
    },
  });
}

async function loadPromptFiles(files: string[]): Promise<string | undefined> {
  const blocks: string[] = [];

  for (const filePath of files) {
    const content = await readPromptFile(filePath);
    if (!content) {
      continue;
    }

    blocks.push(...renderPromptBlock(filePath, content, blocks.length > 0));
  }

  if (blocks.length === 0) {
    return undefined;
  }

  return [
    '# Codara Prompt Manual',
    '',
    'Loaded from the Codara prompt stack. Treat this as the product handbook for this workspace.',
    '',
    ...blocks,
  ].join('\n');
}

function discoverPromptFiles(options: PromptWorkspaceOptions): string[] {
  const userHome = options.userHome ?? homedir();
  const projectRoot = resolveWorkspaceRoot(options);
  return [
    path.join(userHome, '.codara', PROMPT_FILE_NAME),
    path.join(projectRoot, '.codara', PROMPT_FILE_NAME),
  ];
}

async function readPromptFile(filePath: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed || undefined;
}

function renderPromptBlock(filePath: string, content: string, addSeparator: boolean): string[] {
  return [
    ...(addSeparator ? [''] : []),
    '## prompt.md',
    `Path: ${filePath}`,
    '',
    content,
  ];
}

function resolvePromptOptions(options: CodaraPromptSourceOptions | PromptOptions): PromptOptions {
  const nested = readNestedPromptOptions(options);
  return {
    cwd: nested?.cwd ?? options.cwd,
    projectRoot: nested?.projectRoot ?? options.projectRoot,
    userHome: nested?.userHome ?? options.userHome,
  };
}

function readNestedPromptOptions(options: CodaraPromptSourceOptions | PromptOptions): PromptOptions | undefined {
  if (!('prompt' in options)) {
    return undefined;
  }

  const nested = options.prompt;
  return nested && typeof nested === 'object' ? nested : undefined;
}

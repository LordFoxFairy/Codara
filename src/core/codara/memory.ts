import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {loadGuidelines, type GuidelinesOptions} from '@core/middleware/guidelines';
import {discoverHierarchicalWorkspaceFiles, resolveWorkspaceRoot, type WorkspaceFileOptions} from '@core/workspace';

export type CodaraMemoryScope = 'global' | 'project';

export interface CodaraMemoryOverview {
  globalPath: string;
  projectPath: string;
  loadedPaths: string[];
}

export interface CodaraMemoryOptions extends WorkspaceFileOptions {
  guidelines?: boolean | GuidelinesOptions;
}

export async function inspectCodaraMemory(options: CodaraMemoryOptions = {}): Promise<CodaraMemoryOverview> {
  const {globalPath, projectPath} = resolveCodaraMemoryTargets(options);
  const loaded = options.guidelines === false
    ? undefined
    : await loadGuidelines(resolveGuidelinesOptions(options));

  return {
    globalPath,
    projectPath,
    loadedPaths: loaded?.files.map((file) => file.path) ?? [],
  };
}

export async function ensureCodaraMemoryTarget(
  options: CodaraMemoryOptions = {},
  scope: CodaraMemoryScope = 'project',
): Promise<string> {
  const {globalPath, projectPath} = resolveCodaraMemoryTargets(options);
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

function resolveCodaraMemoryTargets(options: CodaraMemoryOptions): {
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

function resolveGuidelinesOptions(options: CodaraMemoryOptions): GuidelinesOptions {
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

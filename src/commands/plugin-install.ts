/**
 * Plugin install command.
 *
 * Supports two input forms:
 *  1. Known plugin specs: `<name>@<source>` (see {@link SUPPORTED_PLUGINS}).
 *  2. Any git URL: the plugin name is derived from the repo basename.
 *
 * Both paths clone to a temp dir, auto-detect skills/ and commands/, and copy
 * new entries into the resolved destination (project-local or user-global).
 *
 * Git handling lives in `./plugin-install-git`; command-to-skill translation
 * lives in `./plugin-install-commands` — this module only orchestrates them.
 *
 * @module
 */

import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot} from '@config/workspace';
import {derivePluginNameFromUrl, isGitUrl, runGitClone} from './plugin-install-git';
import {importPluginCommandsAsSkills} from './plugin-install-commands';

export interface PluginInstallEnvironment {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
}

export interface PluginInstallResult {
  plugin: string;
  source: string;
  destinationRoot: string;
  installedSkills: string[];
  skippedSkills: string[];
}

interface SupportedPluginDefinition {
  name: string;
  sources: string[];
  repoUrl: string;
  rootPath?: string;
  skillsPath?: string;
  commandsPath?: string;
  localOverrideEnv?: string;
}

const SUPPORTED_PLUGINS: readonly SupportedPluginDefinition[] = [
  {
    name: 'superpowers',
    sources: ['claude-plugins-official', 'superpowers-marketplace'],
    repoUrl: 'https://github.com/obra/superpowers',
    rootPath: '.',
    skillsPath: 'skills',
    localOverrideEnv: 'CODARA_PLUGIN_SUPERPOWERS_SOURCE',
  },
  {
    name: 'code-review',
    sources: ['claude-plugins-official'],
    repoUrl: 'https://github.com/anthropics/claude-plugins-official',
    rootPath: 'plugins/code-review',
    commandsPath: 'commands',
    localOverrideEnv: 'CODARA_PLUGIN_CODE_REVIEW_SOURCE',
  },
  {
    name: 'skill-creator',
    sources: ['claude-plugins-official'],
    repoUrl: 'https://github.com/anthropics/claude-plugins-official',
    rootPath: 'plugins/skill-creator',
    skillsPath: 'skills',
    localOverrideEnv: 'CODARA_PLUGIN_SKILL_CREATOR_SOURCE',
  },
];

export function listSupportedPluginSpecs(): string[] {
  return SUPPORTED_PLUGINS.flatMap((plugin) => plugin.sources.map((source) => `${plugin.name}@${source}`));
}

export async function installPluginSkills(
  spec: string,
  environment: PluginInstallEnvironment = {},
): Promise<PluginInstallResult> {
  if (isGitUrl(spec)) {
    return installFromGitUrl(spec, environment);
  }

  const parsed = parsePluginSpec(spec);
  const definition = SUPPORTED_PLUGINS.find((plugin) =>
    plugin.name === parsed.name && plugin.sources.includes(parsed.source),
  );
  if (!definition) {
    throw new Error([
      `Unknown plugin: ${spec}`,
      'Supported formats:',
      `  /plugin install <plugin>@<source>  (known: ${listSupportedPluginSpecs().join(', ')})`,
      '  /plugin install <git-url>          (any repo with skills/ directory)',
    ].join('\n'));
  }

  return installFromDefinition(definition, parsed.source, environment);
}

async function installFromGitUrl(
  url: string,
  environment: PluginInstallEnvironment,
): Promise<PluginInstallResult> {
  const pluginName = derivePluginNameFromUrl(url);
  const destinationRoot = await resolvePluginDestinationRoot(environment);

  const tempRoot = await mkdtemp(path.join(tmpdir(), `codara-plugin-${pluginName}-`));
  const repoDir = path.join(tempRoot, 'repo');

  try {
    await runGitClone(url, repoDir);
    await mkdir(destinationRoot, {recursive: true});

    const skillsRoot = existsSync(path.join(repoDir, 'skills'))
      ? path.join(repoDir, 'skills')
      : repoDir;
    const copied = await copySkillDirectories(skillsRoot, destinationRoot);

    if (existsSync(path.join(repoDir, 'commands'))) {
      const imported = await importPluginCommandsAsSkills({
        pluginName,
        commandsRoot: path.join(repoDir, 'commands'),
        destinationRoot,
      });
      copied.installedSkills.push(...imported.installedSkills);
      copied.skippedSkills.push(...imported.skippedSkills);
    }

    return {plugin: pluginName, source: url, destinationRoot, ...copied};
  } finally {
    await rm(tempRoot, {recursive: true, force: true});
  }
}

async function installFromDefinition(
  definition: SupportedPluginDefinition,
  source: string,
  environment: PluginInstallEnvironment,
): Promise<PluginInstallResult> {
  const destinationRoot = await resolvePluginDestinationRoot(environment);
  const sourceRoot = await materializePluginSource(definition);

  try {
    await mkdir(destinationRoot, {recursive: true});

    const pluginRoot = resolvePluginRoot(sourceRoot, definition.rootPath);
    const copied = definition.skillsPath
      ? await copySkillDirectories(resolveRelativeDir(pluginRoot, definition.skillsPath), destinationRoot)
      : {installedSkills: [] as string[], skippedSkills: [] as string[]};

    if (definition.commandsPath) {
      const imported = await importPluginCommandsAsSkills({
        pluginName: definition.name,
        commandsRoot: resolveRelativeDir(pluginRoot, definition.commandsPath),
        destinationRoot,
      });
      copied.installedSkills.push(...imported.installedSkills);
      copied.skippedSkills.push(...imported.skippedSkills);
    }

    return {plugin: definition.name, source, destinationRoot, ...copied};
  } finally {
    if (sourceRoot.cleanup) {
      await sourceRoot.cleanup();
    }
  }
}

async function resolvePluginDestinationRoot(environment: PluginInstallEnvironment): Promise<string> {
  const scope = await resolvePluginInstallScope(environment);
  if (scope === 'project') {
    return path.join(resolveWorkspaceRoot({
      cwd: environment.cwd,
      projectRoot: environment.projectRoot,
    }), '.codara', 'skills');
  }

  return path.join(path.resolve(environment.userHome ?? homedir()), '.codara', 'skills');
}

async function resolvePluginInstallScope(environment: PluginInstallEnvironment): Promise<'global' | 'project'> {
  const projectRoot = resolveWorkspaceRoot({cwd: environment.cwd, projectRoot: environment.projectRoot});
  const userHome = path.resolve(environment.userHome ?? homedir());

  for (const settingsPath of [
    path.join(projectRoot, '.codara', 'settings.json'),
    path.join(userHome, '.codara', 'settings.json'),
  ]) {
    try {
      if (!existsSync(settingsPath)) continue;
      const content = JSON.parse(await readFile(settingsPath, 'utf8'));
      if (typeof content?.plugins?.installGlobal === 'boolean') {
        return content.plugins.installGlobal ? 'global' : 'project';
      }
    } catch { /* settings file unreadable, try next */ }
  }

  return 'global';
}

interface MaterializedPluginSource {
  rootDir: string;
  cleanup?: () => Promise<void>;
}

async function materializePluginSource(definition: SupportedPluginDefinition): Promise<MaterializedPluginSource> {
  const overrideRoot = definition.localOverrideEnv ? process.env[definition.localOverrideEnv]?.trim() : undefined;
  if (overrideRoot) {
    return {rootDir: path.resolve(overrideRoot)};
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), `codara-plugin-${definition.name}-`));
  const repoDir = path.join(tempRoot, 'repo');
  await runGitClone(definition.repoUrl, repoDir);

  return {
    rootDir: repoDir,
    cleanup: async () => {
      await rm(tempRoot, {recursive: true, force: true});
    },
  };
}

function resolvePluginRoot(source: MaterializedPluginSource, rootPath: string | undefined): string {
  const candidate = path.join(source.rootDir, rootPath ?? '.');
  return existsSync(candidate) ? candidate : source.rootDir;
}

function resolveRelativeDir(rootDir: string, relativePath: string): string {
  const candidate = path.join(rootDir, relativePath);
  return existsSync(candidate) ? candidate : rootDir;
}

async function copySkillDirectories(
  skillsRoot: string,
  destinationRoot: string,
): Promise<{installedSkills: string[]; skippedSkills: string[]}> {
  const installedSkills: string[] = [];
  const skippedSkills: string[] = [];
  const skillNames = await listSkillDirectories(skillsRoot);

  for (const skillName of skillNames) {
    const fromDir = path.join(skillsRoot, skillName);
    const toDir = path.join(destinationRoot, skillName);
    if (existsSync(toDir)) {
      skippedSkills.push(skillName);
      continue;
    }
    await cp(fromDir, toDir, {recursive: true});
    installedSkills.push(skillName);
  }

  return {installedSkills, skippedSkills};
}

async function listSkillDirectories(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(path.join(rootDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function parsePluginSpec(spec: string): {name: string; source: string} {
  const [rawName, rawSource] = spec.trim().toLowerCase().split('@');
  if (!rawName || !rawSource) {
    throw new Error('Usage: /plugin install <plugin>@<source>');
  }

  return {
    name: rawName.trim(),
    source: rawSource.trim(),
  };
}

import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {parseMarkdownFrontmatterDocument} from '@core/skills/loading';
import {resolvePluginInstallGlobal} from '@core/settings';
import {resolveWorkspaceRoot} from '@core/shared/workspace';

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
  const parsed = parsePluginSpec(spec);
  const definition = SUPPORTED_PLUGINS.find((plugin) =>
    plugin.name === parsed.name && plugin.sources.includes(parsed.source),
  );
  if (!definition) {
    throw new Error([
      `Unsupported plugin: ${spec}`,
      `Supported plugin specs: ${listSupportedPluginSpecs().join(', ')}`,
    ].join('\n'));
  }

  const destinationRoot = await resolvePluginDestinationRoot(environment);
  const sourceRoot = await materializePluginSource(definition);

  try {
    const installedSkills: string[] = [];
    const skippedSkills: string[] = [];

    await mkdir(destinationRoot, {recursive: true});

    const pluginRoot = resolvePluginRoot(sourceRoot, definition.rootPath);
    if (definition.skillsPath) {
      const skillsRoot = resolveRelativeDir(pluginRoot, definition.skillsPath);
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
    }

    if (definition.commandsPath) {
      const commandsRoot = resolveRelativeDir(pluginRoot, definition.commandsPath);
      const importedCommands = await importPluginCommandsAsSkills({
        pluginName: definition.name,
        commandsRoot,
        destinationRoot,
      });
      installedSkills.push(...importedCommands.installedSkills);
      skippedSkills.push(...importedCommands.skippedSkills);
    }

    return {
      plugin: definition.name,
      source: parsed.source,
      destinationRoot,
      installedSkills,
      skippedSkills,
    };
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
  return resolvePluginInstallGlobal(environment) ? 'global' : 'project';
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
  if (existsSync(candidate)) {
    return candidate;
  }

  return source.rootDir;
}

function resolveRelativeDir(rootDir: string, relativePath: string): string {
  const candidate = path.join(rootDir, relativePath);
  if (existsSync(candidate)) {
    return candidate;
  }

  return rootDir;
}

async function listSkillDirectories(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(path.join(rootDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

async function importPluginCommandsAsSkills(input: {
  pluginName: string;
  commandsRoot: string;
  destinationRoot: string;
}): Promise<{installedSkills: string[]; skippedSkills: string[]}> {
  if (!existsSync(input.commandsRoot)) {
    return {installedSkills: [], skippedSkills: []};
  }

  const entries = await readdir(input.commandsRoot, {withFileTypes: true});
  const installedSkills: string[] = [];
  const skippedSkills: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const commandFile = path.join(input.commandsRoot, entry.name);
    const command = await translatePluginCommand(commandFile, input.pluginName);
    if (!command) {
      continue;
    }

    const skillDir = path.join(input.destinationRoot, command.skillName);
    if (existsSync(skillDir)) {
      skippedSkills.push(command.skillName);
      continue;
    }

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), command.skillContent, 'utf8');
    installedSkills.push(command.skillName);
  }

  return {installedSkills, skippedSkills};
}

async function translatePluginCommand(
  commandFile: string,
  pluginName: string,
): Promise<{skillName: string; skillContent: string} | undefined> {
  const raw = await readFile(commandFile, 'utf8');
  const parsed = parseMarkdownFrontmatterDocument(raw, commandFile);
  const body = parsed?.body?.trim() ?? raw.trim();
  const frontmatter = parsed?.frontmatter ?? {};
  const commandName = normalizeCommandName(path.basename(commandFile, '.md'));
  if (!commandName) {
    return undefined;
  }

  const skillName = normalizeSkillName(`${pluginName}-${commandName}`);
  const description = normalizeScalar(frontmatter.description) ?? `Imported plugin command ${commandName}.`;
  const allowedTools = normalizeAllowedTools(frontmatter['allowed-tools']);
  const lines = [
    '---',
    `name: ${skillName}`,
    `description: ${escapeYamlScalar(description)}`,
    `command-name: ${commandName}`,
    `command-description: ${escapeYamlScalar(description)}`,
    `command-usage: /${commandName}`,
    ...(allowedTools.length > 0 ? [`allowed-tools: ${allowedTools.join(', ')}`] : []),
    'metadata:',
    `  imported-from-plugin: ${pluginName}`,
    `  source-command: ${path.basename(commandFile)}`,
    '---',
    '',
    `# Imported Plugin Command: /${commandName}`,
    '',
    `This skill was generated from the ${pluginName} plugin command \`${path.basename(commandFile)}\`.`,
    '',
    body,
    '',
  ];

  return {
    skillName,
    skillContent: `${lines.join('\n')}\n`,
  };
}

function normalizeCommandName(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || undefined;
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeScalar(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function escapeYamlScalar(value: string): string {
  return JSON.stringify(value);
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

async function runGitClone(repoUrl: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', repoUrl, destination], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(new Error(`Failed to start git clone: ${error.message}`));
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `git clone failed with exit code ${code ?? -1}`));
    });
  });
}

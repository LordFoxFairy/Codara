import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readdir, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';

export interface PluginInstallEnvironment {
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
  skillsPath: string;
  localOverrideEnv?: string;
}

const SUPPORTED_PLUGINS: readonly SupportedPluginDefinition[] = [
  {
    name: 'superpowers',
    sources: ['claude-plugins-official', 'superpowers-marketplace'],
    repoUrl: 'https://github.com/obra/superpowers',
    skillsPath: 'skills',
    localOverrideEnv: 'CODARA_PLUGIN_SUPERPOWERS_SOURCE',
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

  const destinationRoot = path.join(path.resolve(environment.userHome ?? homedir()), '.codara', 'skills');
  const sourceRoot = await materializePluginSource(definition);

  try {
    const skillsRoot = resolveSkillsRoot(sourceRoot, definition.skillsPath);
    const skillNames = await listSkillDirectories(skillsRoot);
    const installedSkills: string[] = [];
    const skippedSkills: string[] = [];

    await mkdir(destinationRoot, {recursive: true});

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

function resolveSkillsRoot(source: MaterializedPluginSource, skillsPath: string): string {
  const candidate = path.join(source.rootDir, skillsPath);
  if (existsSync(candidate)) {
    return candidate;
  }

  return source.rootDir;
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

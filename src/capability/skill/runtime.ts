import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {parseMarkdownDocument} from '@capability/skill/loading';
import {normalizeDiscoveredSkills} from '@capability/skill/metadata';
import type {SkillMetadata, SkillStore} from '@infra/context/skill-contracts';
import type {SubagentDefinition} from '@infra/context/skill-contracts';

// Re-export contracts so existing consumers continue to work
export {
  DEFAULT_SUBAGENT_TYPE,
  readSkillsRuntimeData,
  resolveSubagentDefinition,
  type SkillsRuntimeData,
  type SubagentDefinition,
  type SubagentDefinitionHints,
} from '@infra/context/skill-contracts';

const subagentFrontmatterSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  permissionMode: z.string().trim().min(1).optional(),
  permission_mode: z.string().trim().min(1).optional(),
  maxTurns: z.number().optional(),
  max_turns: z.number().optional(),
}).loose();

export async function loadSkillsRuntimeData(
  store: SkillStore,
  subagentRoots: string[] = []
): Promise<import('@infra/context/skill-contracts').SkillsRuntimeData> {
  const discovered = normalizeDiscoveredSkills(await store.discover());
  const sources = store.listSources?.() ?? [];
  const subagentDefinitions = await loadSubagentDefinitions(discovered, subagentRoots);

  return {
    sources,
    discovered,
    subagentDefinitions,
  };
}

async function loadSubagentDefinitions(
  discovered: SkillMetadata[],
  subagentRoots: string[]
): Promise<Record<string, SubagentDefinition>> {
  const byName = new Map<string, SubagentDefinition>();

  for (const skill of discovered) {
    const definition = await loadDefinitionFile(path.join(path.dirname(skill.path), 'agents'));
    for (const [name, value] of definition) {
      byName.set(name, value);
    }
  }

  for (const root of subagentRoots) {
    const definition = await loadDefinitionFile(root);
    for (const [name, value] of definition) {
      byName.set(name, value);
    }
  }

  return Object.fromEntries(byName);
}

async function loadDefinitionFile(root: string): Promise<Map<string, SubagentDefinition>> {
  const definitions = new Map<string, SubagentDefinition>();
  let entries: string[] = [];

  try {
    entries = await readdir(root);
  } catch {
    return definitions;
  }

  for (const fileName of entries.filter((entry) => entry.endsWith('.md'))) {
    const definition = await parseDefinitionFile(path.join(root, fileName));
    if (!definition) {
      continue;
    }
    definitions.set(definition.name, definition);
  }

  return definitions;
}

async function parseDefinitionFile(filePath: string): Promise<SubagentDefinition | undefined> {
  if (!await fileExists(filePath)) {
    return undefined;
  }

  let content = '';
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }

  const document = parseMarkdownDocument(content, filePath);
  if (!document) {
    return undefined;
  }

  const frontmatter = subagentFrontmatterSchema.safeParse(document.frontmatter);
  const parsedFrontmatter = frontmatter.success ? frontmatter.data : {};
  const name = parsedFrontmatter.name ?? path.basename(filePath, '.md');
  const description = parsedFrontmatter.description ?? readDefaultDefinitionDescription(document.body, name);
  const tools = readStringList(document.frontmatter.tools);
  const middlewareNames = readStringList(document.frontmatter.middleware ?? document.frontmatter.middlewares);
  const model = parsedFrontmatter.model;
  const permissionMode = parsedFrontmatter.permissionMode ?? parsedFrontmatter.permission_mode;
  const maxTurns = parsedFrontmatter.maxTurns ?? parsedFrontmatter.max_turns;
  const hints = {
    ...(middlewareNames.length > 0 ? {middlewareNames} : {}),
    ...(model ? {model} : {}),
    ...(permissionMode ? {permissionMode} : {}),
  };

  return {
    name,
    description,
    systemPrompt: document.body.trim(),
    ...(tools.length > 0 ? {tools} : {}),
    ...(typeof maxTurns === 'number' ? {maxTurns} : {}),
    ...(Object.keys(hints).length > 0 ? {hints} : {}),
  };
}

function readDefaultDefinitionDescription(body: string, fallback: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    return trimmed.replace(/^#+\s*/, '') || fallback;
  }

  return fallback;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

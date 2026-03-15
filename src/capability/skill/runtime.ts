import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {parseMarkdownDocument} from '@capability/skill/loading';
import {normalizeDiscoveredSkills} from '@capability/skill/metadata';
import type {SkillMetadata, SkillStore} from '@capability/skill/types';

const subagentHintsSchema = z.object({
  model: z.string().trim().min(1).optional(),
  middlewareNames: z.array(z.string().trim().min(1)).optional(),
  permissionMode: z.string().trim().min(1).optional(),
});

const subagentDefinitionSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  systemPrompt: z.string(),
  tools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  hints: subagentHintsSchema.optional(),
});

const skillsRuntimeDataSchema = z.object({
  discovered: z.array(z.custom<SkillMetadata>(() => true)),
  sources: z.array(z.string()),
  subagentDefinitions: z.record(z.string(), subagentDefinitionSchema),
});

const subagentFrontmatterSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  permissionMode: z.string().trim().min(1).optional(),
  permission_mode: z.string().trim().min(1).optional(),
  maxTurns: z.number().optional(),
  max_turns: z.number().optional(),
}).loose();

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  maxTurns?: number;
  /** Non-authoritative metadata from agent markdown. These do not auto-mutate child runtime. */
  hints?: SubagentDefinitionHints;
}

export interface SubagentDefinitionHints {
  model?: string;
  middlewareNames?: string[];
  permissionMode?: string;
}

export interface SkillsRuntimeData {
  sources: string[];
  discovered: SkillMetadata[];
  subagentDefinitions: Record<string, SubagentDefinition>;
}

export const DEFAULT_SUBAGENT_TYPE = 'general-purpose';

const DEFAULT_SUBAGENT_DEFINITION: SubagentDefinition = {
  name: DEFAULT_SUBAGENT_TYPE,
  description: 'General-purpose delegate',
  systemPrompt: '',
};

export async function loadSkillsRuntimeData(
  store: SkillStore,
  subagentRoots: string[] = []
): Promise<SkillsRuntimeData> {
  const discovered = normalizeDiscoveredSkills(await store.discover());
  const sources = store.listSources?.() ?? [];
  const subagentDefinitions = await loadSubagentDefinitions(discovered, subagentRoots);

  return {
    sources,
    discovered,
    subagentDefinitions,
  };
}

const runtimeSharedSchema = z.object({
  skills: z.unknown().optional(),
}).loose();

export function readSkillsRuntimeData(shared: unknown): SkillsRuntimeData | undefined {
  const runtime = runtimeSharedSchema.safeParse(shared);
  const parsed = skillsRuntimeDataSchema.safeParse(runtime.success ? runtime.data.skills : undefined);
  return parsed.success ? parsed.data : undefined;
}

export function resolveSubagentDefinition(
  runtime: SkillsRuntimeData | undefined,
  subagentType: string | undefined
): SubagentDefinition {
  const definitionName = normalizeDefinitionName(subagentType);
  const definition = runtime?.subagentDefinitions?.[definitionName];

  if (definition) {
    return definition;
  }

  if (definitionName === DEFAULT_SUBAGENT_TYPE) {
    return DEFAULT_SUBAGENT_DEFINITION;
  }

  throw new Error(`Unknown subagent_type "${definitionName}"`);
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

function normalizeDefinitionName(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_SUBAGENT_TYPE;
}

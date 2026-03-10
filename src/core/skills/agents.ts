import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {MiddlewareRuntimeShared} from '@core/middleware';
import {parseMarkdownFrontmatterDocument} from '@core/skills/loading';
import {normalizeDiscoveredSkills} from '@core/skills/metadata';
import type {SkillMetadata, SkillStore} from '@core/skills/types';

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
  agentDefinitions: Record<string, SubagentDefinition>;
}

export async function loadSkillsRuntimeData(
  store: SkillStore,
  agentRoots: string[] = []
): Promise<SkillsRuntimeData> {
  const discovered = normalizeDiscoveredSkills(await store.discover());
  const sources = store.listSources?.() ?? [];
  const agentDefinitions = await loadAgentDefinitions(discovered, agentRoots);

  return {
    sources,
    discovered,
    agentDefinitions,
  };
}

export function readSkillsRuntimeData(shared: MiddlewareRuntimeShared | undefined): SkillsRuntimeData | undefined {
  const record = shared?.skills;
  if (!isRecord(record)) {
    return undefined;
  }

  const discovered = Array.isArray(record.discovered) ? record.discovered : undefined;
  const sources = Array.isArray(record.sources) ? record.sources : undefined;
  const agentDefinitions = isRecord(record.agentDefinitions) ? record.agentDefinitions : undefined;

  if (!discovered || !sources || !agentDefinitions) {
    return undefined;
  }

  return {
    discovered: discovered as SkillMetadata[],
    sources: sources.filter((value): value is string => typeof value === 'string'),
    agentDefinitions: agentDefinitions as Record<string, SubagentDefinition>,
  };
}

export function resolveSubagentDefinition(
  runtime: SkillsRuntimeData | undefined,
  subagentType: string | undefined
): SubagentDefinition {
  const definitionName = normalizeDefinitionName(subagentType);
  const definition = runtime?.agentDefinitions?.[definitionName];

  if (!definition) {
    throw new Error(`Unknown subagent_type "${definitionName}"`);
  }

  return definition;
}

async function loadAgentDefinitions(
  discovered: SkillMetadata[],
  agentRoots: string[]
): Promise<Record<string, SubagentDefinition>> {
  const byName = new Map<string, SubagentDefinition>();

  for (const skill of discovered) {
    const definition = await loadDefinitionFile(path.join(path.dirname(skill.path), 'agents'));
    for (const [name, value] of definition) {
      byName.set(name, value);
    }
  }

  for (const root of agentRoots) {
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

  const document = parseMarkdownFrontmatterDocument(content, filePath);
  if (!document) {
    return undefined;
  }

  const name = typeof document.frontmatter.name === 'string'
    ? document.frontmatter.name.trim()
    : path.basename(filePath, '.md');
  const description = typeof document.frontmatter.description === 'string'
    ? document.frontmatter.description.trim()
    : document.body.split('\n').find((line) => line.trim())?.trim() ?? name;
  const tools = readStringList(document.frontmatter.tools);
  const middlewareNames = readStringList(document.frontmatter.middleware ?? document.frontmatter.middlewares);
  const model = readOptionalString(document.frontmatter.model);
  const permissionMode = readOptionalString(document.frontmatter.permissionMode ?? document.frontmatter.permission_mode);
  const maxTurns = readOptionalNumber(document.frontmatter.maxTurns ?? document.frontmatter.max_turns);
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
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
  return normalized || 'general-purpose';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

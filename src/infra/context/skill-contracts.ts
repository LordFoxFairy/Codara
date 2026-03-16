/**
 * Skill contracts — types and pure utilities shared between engine and capability layers.
 *
 * These live in infra (accessible to both engine and capability) to prevent
 * the engine ↔ capability cross-layer dependency cycle.
 */

import {z} from 'zod';

// ---------------------------------------------------------------------------
// Types (from capability/skill/types.ts)
// ---------------------------------------------------------------------------

export interface SkillCommandMetadata {
  name: string
  description?: string
  usage?: string
  aliases?: string[]
}

export interface SkillMetadata {
  name: string
  description: string
  path: string
  license?: string | null
  compatibility?: string | null
  metadata?: Record<string, string>
  allowedTools?: string[]
  command?: SkillCommandMetadata
  frontmatter?: Record<string, unknown>
  extensions?: Record<string, unknown>
}

export interface SkillStore {
  discover(): Promise<SkillMetadata[]>
  listSources?(): string[]
  refresh?(): Promise<void> | void
}

// ---------------------------------------------------------------------------
// Runtime types (from capability/skill/runtime.ts)
// ---------------------------------------------------------------------------

export interface SubagentDefinitionHints {
  model?: string;
  middlewareNames?: string[];
  permissionMode?: string;
}

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  maxTurns?: number;
  hints?: SubagentDefinitionHints;
}

export interface SkillsRuntimeData {
  sources: string[];
  discovered: SkillMetadata[];
  subagentDefinitions: Record<string, SubagentDefinition>;
}

// ---------------------------------------------------------------------------
// SkillsSource interface (from capability/skill/source.ts)
// ---------------------------------------------------------------------------

export interface SkillsSource {
  getRuntime(): Promise<SkillsRuntimeData>;
  reload(): void;
}

// ---------------------------------------------------------------------------
// Runtime data accessors (from capability/skill/runtime.ts)
// ---------------------------------------------------------------------------

const subagentDefinitionSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  systemPrompt: z.string(),
  tools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  hints: z.object({
    model: z.string().trim().min(1).optional(),
    middlewareNames: z.array(z.string().trim().min(1)).optional(),
    permissionMode: z.string().trim().min(1).optional(),
  }).optional(),
});

const skillsRuntimeDataSchema = z.object({
  discovered: z.array(z.custom<SkillMetadata>(() => true)),
  sources: z.array(z.string()),
  subagentDefinitions: z.record(z.string(), subagentDefinitionSchema),
});

const runtimeSharedSchema = z.object({
  skills: z.unknown().optional(),
}).loose();

export const DEFAULT_SUBAGENT_TYPE = 'general-purpose';

const DEFAULT_SUBAGENT_DEFINITION: SubagentDefinition = {
  name: DEFAULT_SUBAGENT_TYPE,
  description: 'General-purpose delegate',
  systemPrompt: '',
};

export function readSkillsRuntimeData(shared: unknown): SkillsRuntimeData | undefined {
  const runtime = runtimeSharedSchema.safeParse(shared);
  const parsed = skillsRuntimeDataSchema.safeParse(runtime.success ? runtime.data.skills : undefined);
  return parsed.success ? parsed.data : undefined;
}

export function resolveSubagentDefinition(
  runtime: SkillsRuntimeData | undefined,
  subagentType: string | undefined
): SubagentDefinition {
  const normalized = subagentType?.trim() || DEFAULT_SUBAGENT_TYPE;
  const definition = runtime?.subagentDefinitions?.[normalized];

  if (definition) {
    return definition;
  }

  if (normalized === DEFAULT_SUBAGENT_TYPE) {
    return DEFAULT_SUBAGENT_DEFINITION;
  }

  throw new Error(`Unknown subagent_type "${normalized}"`);
}

// ---------------------------------------------------------------------------
// Formatting utilities (from capability/skill/metadata.ts)
// ---------------------------------------------------------------------------

export const SKILLS_SYSTEM_PROMPT = `
## Skills System

Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/debug"), they are referring to a skill. Use the Skill tool to invoke it.

{skills_locations}

**Available Skills:**

{skills_list}

Important:
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling the Skill tool
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded — follow the instructions directly instead of calling the Skill tool again
- Do not invoke a skill that is already running
`;

export function formatSkillAnnotations(skill: SkillMetadata): string {
  const parts: string[] = [];
  if (skill.license) {
    parts.push(`License: ${skill.license}`);
  }
  if (skill.compatibility) {
    parts.push(`Compatibility: ${skill.compatibility}`);
  }
  return parts.join(', ');
}

export function formatSkillsLocations(sources: string[]): string {
  if (sources.length === 0) {
    return '**Skills Sources:** None configured';
  }

  const lines: string[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const sourcePath = sources[i];
    const name =
      sourcePath
        .replace(/[/\\]$/, '')
        .split(/[/\\]/)
        .filter(Boolean)
        .pop()
        ?.replace(/^./, (char) => char.toUpperCase()) ?? 'Skills';
    const suffix = i === sources.length - 1 ? ' (higher priority)' : '';
    lines.push(`**${name} Skills**: \`${sourcePath}\`${suffix}`);
  }
  return lines.join('\n');
}

export function formatSkillsList(skills: SkillMetadata[], sources: string[]): string {
  if (skills.length === 0) {
    return sources.length > 0
      ? `(No skills available yet. Add SKILL.md files to ${sources.map((s) => `\`${s}\``).join(' or ')})`
      : '(No skills available yet.)';
  }

  return skills.map((skill) => {
    const cmd = skill.command?.name ? ` (/${skill.command.name})` : '';
    const loc = skill.path ? `\n  Path: ${skill.path}` : '';
    return `- ${skill.name}${cmd}: ${skill.description}${loc}`;
  }).join('\n');
}

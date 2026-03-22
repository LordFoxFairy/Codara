import {z} from 'zod';
import type {SkillMetadata, SkillsRuntimeData, SubagentDefinition} from '@context/skills/contracts';

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

export const AGENT_SUBAGENT_TYPE = 'Agent';

const AGENT_SUBAGENT_DEFINITION: SubagentDefinition = {
  name: AGENT_SUBAGENT_TYPE,
  description: 'Built-in Agent child that starts fresh and loads project context through normal bootstrap',
  systemPrompt: '',
};

const RESERVED_SUBAGENT_NAMES = new Set(['general-purpose', 'default', 'agent']);

export function readSkillsRuntimeData(shared: unknown): SkillsRuntimeData | undefined {
  const runtime = runtimeSharedSchema.safeParse(shared);
  const parsed = skillsRuntimeDataSchema.safeParse(runtime.success ? runtime.data.skills : undefined);
  return parsed.success ? parsed.data : undefined;
}

export function resolveSubagentDefinition(
  runtime: SkillsRuntimeData | undefined,
  subagentType: string | undefined,
): SubagentDefinition {
  const normalized = normalizeSubagentType(subagentType);
  if (!normalized) {
    throw new Error('Agent requires subagent_type. Use "Agent" for the base child or a named profile such as "Explore".');
  }

  if (normalized.toLowerCase() === AGENT_SUBAGENT_TYPE.toLowerCase()) {
    return AGENT_SUBAGENT_DEFINITION;
  }

  const definition = runtime?.subagentDefinitions?.[normalized];
  if (definition) {
    return definition;
  }

  throw new Error(`Unknown subagent_type "${normalized}"`);
}

export function normalizeSubagentType(subagentType: string | undefined): string | undefined {
  const normalized = subagentType?.trim();
  return normalized || undefined;
}

export function formatSubagentDisplayName(subagentType: string | undefined): string {
  return normalizeSubagentType(subagentType) ?? AGENT_SUBAGENT_TYPE;
}

export function isReservedSubagentName(name: string | undefined): boolean {
  const normalized = name?.trim().toLowerCase();
  return Boolean(normalized && RESERVED_SUBAGENT_NAMES.has(normalized));
}

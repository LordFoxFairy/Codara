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
  subagentType: string | undefined,
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

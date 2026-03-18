import {z} from 'zod'
import type {SkillMetadata} from '@context/skills/contracts'

// Re-export contracts so existing consumers continue to work
export {
  SKILLS_SYSTEM_PROMPT,
  formatSkillAnnotations,
  formatSkillsList,
  formatSkillsLocations,
} from '@context/prompts/skills-system-prompt';

export const SkillMetadataEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  license: z.string().nullable().optional(),
  compatibility: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  command: z.object({
    name: z.string(),
    description: z.string().optional(),
    usage: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  }).optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional()
})

export type SkillMetadataEntry = z.infer<typeof SkillMetadataEntrySchema>

/**
 * Merge metadata arrays from layered/parallel sources by skill name.
 * Later entries override earlier entries.
 */
export function skillsMetadataReducer(
  current: SkillMetadataEntry[] | undefined,
  update: SkillMetadataEntry[] | undefined
): SkillMetadataEntry[] {
  if (!update || update.length === 0) {
    return current ?? []
  }
  if (!current || current.length === 0) {
    return update
  }

  const merged = new Map<string, SkillMetadataEntry>()
  for (const skill of current) {
    merged.set(skill.name, skill)
  }
  for (const skill of update) {
    merged.set(skill.name, skill)
  }
  return Array.from(merged.values())
}

export function normalizeDiscoveredSkills(skills: SkillMetadata[]): SkillMetadata[] {
  const normalized: SkillMetadata[] = []
  for (const skill of skills) {
    const parsed = SkillMetadataEntrySchema.safeParse(skill)
    if (parsed.success) {
      normalized.push(parsed.data)
    }
  }
  return normalized
}

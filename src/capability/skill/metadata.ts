import {z} from 'zod'
import type {SkillMetadata} from '@capability/skill/types'

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

export const SKILLS_SYSTEM_PROMPT = `
## Skills System

Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/debug"), they are referring to a skill.

{skills_locations}

**Available Skills:**

{skills_list}

Important:
- When a skill matches the user's request, read the skill's SKILL.md for full instructions BEFORE generating any other response
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded — follow the instructions directly instead of reading the file again
- Do not invoke a skill that is already running
`

export function formatSkillAnnotations(skill: SkillMetadata): string {
  const parts: string[] = []
  if (skill.license) {
    parts.push(`License: ${skill.license}`)
  }
  if (skill.compatibility) {
    parts.push(`Compatibility: ${skill.compatibility}`)
  }
  return parts.join(', ')
}

export function formatSkillsLocations(sources: string[]): string {
  if (sources.length === 0) {
    return '**Skills Sources:** None configured'
  }

  const lines: string[] = []
  for (let i = 0; i < sources.length; i += 1) {
    const sourcePath = sources[i]
    const name =
      sourcePath
        .replace(/[/\\]$/, '')
        .split(/[/\\]/)
        .filter(Boolean)
        .pop()
        ?.replace(/^./, (char) => char.toUpperCase()) ?? 'Skills'
    const suffix = i === sources.length - 1 ? ' (higher priority)' : ''
    lines.push(`**${name} Skills**: \`${sourcePath}\`${suffix}`)
  }
  return lines.join('\n')
}

export function formatSkillsList(skills: SkillMetadata[], sources: string[]): string {
  if (skills.length === 0) {
    return sources.length > 0
      ? `(No skills available yet. Add SKILL.md files to ${sources.map((s) => `\`${s}\``).join(' or ')})`
      : '(No skills available yet.)'
  }

  return skills.map((skill) => {
    const cmd = skill.command?.name ? ` (/${skill.command.name})` : ''
    const loc = skill.path ? `\n  Path: ${skill.path}` : ''
    return `- ${skill.name}${cmd}: ${skill.description}${loc}`
  }).join('\n')
}

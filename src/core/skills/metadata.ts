import {z} from 'zod'
import type {SkillMetadata} from '@core/skills/types'

export const SkillMetadataEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  license: z.string().nullable().optional(),
  compatibility: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
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

You have access to a skills library that provides specialized capabilities and domain knowledge.

{skills_locations}

**Available Skills:**

{skills_list}

**How to Use Skills (Progressive Disclosure):**

Skills follow a **progressive disclosure** pattern - you know they exist (name + description above), but you only read the full instructions when needed:

1. **Recognize when a skill applies**: Check if the user's task matches any skill's description
2. **Read the skill's full instructions**: The skill list above shows the exact path to use with read_file
3. **Follow the skill's instructions**: SKILL.md contains step-by-step workflows, best practices, and examples
4. **Access supporting files**: Skills may include scripts, configs, or reference docs - use absolute paths

**When to Use Skills:**
- When the user's request matches a skill's domain (e.g., "research X" -> web-research skill)
- When you need specialized knowledge or structured workflows
- When a skill provides proven patterns for complex tasks

**Skills are Self-Documenting:**
- Each SKILL.md tells you exactly what the skill does and how to use it
- The skill list above shows the full path for each skill's SKILL.md file

**Executing Skill Scripts:**
Skills may contain Python scripts or other executable files. Always use absolute paths from the skill list.

**Example Workflow:**

User: "Can you research the latest developments in quantum computing?"

1. Check available skills above -> See "web-research" skill with its full path
2. Read the skill using the path shown in the list
3. Follow the skill's research workflow (search -> organize -> synthesize)
4. Use any helper scripts with absolute paths

Remember: Skills are tools to make you more capable and consistent. When in doubt, check if a skill exists for the task!
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
    if (sources.length === 0) {
      return '(No skills available yet. Add SKILL.md files to your configured skills directories.)'
    }
    const paths = sources.map((source) => `\`${source}\``).join(' or ')
    return `(No skills available yet. You can create skills in ${paths})`
  }

  const lines: string[] = []
  for (const skill of skills) {
    const annotations = formatSkillAnnotations(skill)
    let descLine = `- **${skill.name}**: ${skill.description}`
    if (annotations) {
      descLine += ` (${annotations})`
    }
    lines.push(descLine)

    if (skill.allowedTools && skill.allowedTools.length > 0) {
      lines.push(`  -> Allowed tools: ${skill.allowedTools.join(', ')}`)
    }
    lines.push(`  -> Read \`${skill.path}\` for full instructions`)
  }

  return lines.join('\n')
}

import yaml from 'yaml'
import type {SkillMetadata} from '@core/skills/types'

export const MAX_SKILL_FILE_SIZE = 10 * 1024 * 1024
export const MAX_SKILL_NAME_LENGTH = 64
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024
export const MAX_SKILL_COMPATIBILITY_LENGTH = 500

const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
  'allowedTools'
])

/**
 * Same name/contract as docs/deepagents/skills.ts.
 */
export function validateSkillName(
  name: string,
  directoryName: string
): {valid: boolean; error: string} {
  if (!name) {
    return {valid: false, error: 'name is required'}
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return {valid: false, error: `name exceeds ${MAX_SKILL_NAME_LENGTH} characters`}
  }
  if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
    return {valid: false, error: 'name must be lowercase alphanumeric with single hyphens only'}
  }

  for (const c of name) {
    if (c === '-') {
      continue
    }
    if (/\p{Ll}/u.test(c) || /\p{Nd}/u.test(c)) {
      continue
    }
    return {valid: false, error: 'name must be lowercase alphanumeric with single hyphens only'}
  }

  if (name !== directoryName) {
    return {valid: false, error: `name '${name}' must match directory name '${directoryName}'`}
  }

  return {valid: true, error: ''}
}

/**
 * Same name/intent as docs/deepagents/skills.ts.
 */
export function validateMetadata(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
    return {}
  }

  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    metadata[String(key)] = String(value)
  }
  return metadata
}

/**
 * Parse SKILL.md metadata.
 *
 * Strategy:
 * - Keep Agent Skills core fields strict-ish and bounded
 * - Keep middleware runtime semantic fields minimal
 * - Preserve unknown keys in `extensions` and full frontmatter in `frontmatter`
 */
export function parseSkillMetadataFromContent(
  content: string,
  skillPath: string,
  directoryName: string
): SkillMetadata | null {
  if (content.length > MAX_SKILL_FILE_SIZE) {
    console.warn(`Skipping ${skillPath}: content too large (${content.length} bytes)`)
    return null
  }

  const frontmatterData = parseFrontmatter(content, skillPath)
  if (!frontmatterData) {
    return null
  }

  const frontmatter = normalizeFrontmatter(frontmatterData)
  const name = parseOptionalString(readFrontmatter(frontmatter, ['name']))
  const description = parseOptionalString(readFrontmatter(frontmatter, ['description']))
  if (!name || !description) {
    console.warn(`Skipping ${skillPath}: missing required 'name' or 'description'`)
    return null
  }

  let descriptionStr = description
  if (descriptionStr.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    console.warn(`Description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters in ${skillPath}, truncating`)
    descriptionStr = descriptionStr.slice(0, MAX_SKILL_DESCRIPTION_LENGTH)
  }

  // Match deepagents behavior: validate but do not hard-fail for compatibility.
  const validation = validateSkillName(name, directoryName)
  if (!validation.valid) {
    console.warn(
      `Skill '${name}' in ${skillPath} does not follow Agent Skills specification: ${validation.error}. Consider renaming for spec compliance.`
    )
  }

  const compatibilityRaw = parseOptionalString(readFrontmatter(frontmatter, ['compatibility'])) ?? ''
  const compatibility = compatibilityRaw
    ? compatibilityRaw.length > MAX_SKILL_COMPATIBILITY_LENGTH
      ? compatibilityRaw.slice(0, MAX_SKILL_COMPATIBILITY_LENGTH)
      : compatibilityRaw
    : null
  if (compatibilityRaw.length > MAX_SKILL_COMPATIBILITY_LENGTH) {
    console.warn(`Compatibility exceeds ${MAX_SKILL_COMPATIBILITY_LENGTH} characters in ${skillPath}, truncating`)
  }

  return {
    name,
    description: descriptionStr,
    // Path should always reflect the actual SKILL.md location.
    path: skillPath,
    metadata: validateMetadata(readFrontmatter(frontmatter, ['metadata'])),
    license: parseOptionalString(readFrontmatter(frontmatter, ['license'])),
    compatibility,
    allowedTools: parseAllowedTools(readFrontmatter(frontmatter, ['allowed-tools', 'allowedTools'])),
    frontmatter,
    extensions: parseExtensions(frontmatter)
  }
}

function normalizeFrontmatter(frontmatterData: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatterData)) {
    normalized[String(key)] = value
  }
  return normalized
}

function readFrontmatter(frontmatter: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      return frontmatter[key]
    }
  }
  return undefined
}

function parseOptionalString(value: unknown): string | null {
  if (value == null) {
    return null
  }
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function parseExtensions(frontmatterData: Record<string, unknown>): Record<string, unknown> {
  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatterData)) {
    if (KNOWN_FRONTMATTER_KEYS.has(key)) {
      continue
    }
    extensions[key] = value
  }
  return extensions
}

function parseFrontmatter(
  content: string,
  skillPath: string
): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)
  if (!match) {
    console.warn(`Skipping ${skillPath}: no valid YAML frontmatter found`)
    return null
  }

  try {
    const parsed = yaml.parse(match[1])
    if (!parsed) {
      return {}
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`Skipping ${skillPath}: frontmatter is not a mapping`)
      return null
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    console.warn(`Invalid YAML in ${skillPath}:`, error)
    return null
  }
}

function parseAllowedTools(rawTools: unknown): string[] {
  if (Array.isArray(rawTools)) {
    return dedupe(rawTools.map((item) => String(item).trim()).filter(Boolean))
  }

  const text = String(rawTools ?? '').trim()
  if (!text) {
    return []
  }

  const tokens = splitAllowedTools(text)
  return dedupe(tokens.map((token) => token.trim()).filter(Boolean))
}

function splitAllowedTools(raw: string): string[] {
  const tools: string[] = []
  let current = ''
  let depth = 0

  for (const char of raw) {
    if (char === '(') {
      depth += 1
      current += char
      continue
    }

    if (char === ')') {
      depth = Math.max(depth - 1, 0)
      current += char
      continue
    }

    const isSeparator = (char === ',' || /\s/.test(char)) && depth === 0
    if (isSeparator) {
      const token = current.trim()
      if (token) {
        tools.push(token)
      }
      current = ''
      continue
    }

    current += char
  }

  const last = current.trim()
  if (last) {
    tools.push(last)
  }

  return tools
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }
  return result
}

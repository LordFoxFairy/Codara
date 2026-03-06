/**
 * Canonical metadata model.
 *
 * Core fields align with:
 * - deepagents skills middleware
 * - Agent Skills specification
 */
export interface SkillMetadata {
  /**
   * Agent Skills core fields
   */
  name: string
  description: string
  path: string
  license?: string | null
  compatibility?: string | null
  metadata?: Record<string, string>
  allowedTools?: string[]

  /**
   * Full parsed YAML frontmatter for generic/forward-compatible consumption.
   */
  frontmatter?: Record<string, unknown>
  /**
   * Unknown/custom frontmatter keys are preserved here for forward compatibility.
   */
  extensions?: Record<string, unknown>
}

export interface SkillStore {
  discover(): Promise<SkillMetadata[]>
  listSources?(): string[]
}

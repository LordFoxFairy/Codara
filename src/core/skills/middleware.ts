import {
  createMiddleware,
  type ModelCallContext
} from '@core/middleware'
import {
  SKILLS_SYSTEM_PROMPT,
  formatSkillsList,
  formatSkillsLocations,
} from '@core/skills/metadata'
import {loadSkillsRuntimeData, readSkillsRuntimeData} from '@core/skills/agents'
import type {SkillStore} from '@core/skills/types'

export interface SkillsMiddlewareOptions {
  store: SkillStore
  agentRoots?: string[]
}

/**
 * Deepagents-style skills middleware:
 * - discover skills via store on model call
 * - inject skills system section in wrapModelCall
 *
 * Note:
 * - middleware does not keep run-level cache
 * - caching responsibility is delegated to store implementation
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions) {
  const store = options.store

  return createMiddleware({
    name: 'SkillsMiddleware',

    async beforeAgent() {
      try {
        const runtime = await loadSkillsRuntimeData(store, options.agentRoots ?? [])
        return {
          runtimeShared: {
            skills: runtime
          }
        }
      } catch {
        return undefined
      }
    },

    async beforeModel(context: ModelCallContext) {
      const runtime = readSkillsRuntimeData(context.runtime.shared) ?? await loadSkillsRuntimeData(store, options.agentRoots ?? [])
      const skills = runtime.discovered
      const sources = runtime.sources
      const skillsSection = SKILLS_SYSTEM_PROMPT
        .replace('{skills_locations}', formatSkillsLocations(sources))
        .replace('{skills_list}', formatSkillsList(skills, sources))
      context.systemMessage.push(skillsSection)
      return undefined
    },
  })
}

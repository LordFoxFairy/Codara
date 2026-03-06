import {
  createMiddleware,
  type ModelCallContext
} from '@core/middleware'
import {
  SKILLS_SYSTEM_PROMPT,
  formatSkillsList,
  formatSkillsLocations,
  normalizeDiscoveredSkills
} from '@core/skills/metadata'
import type {SkillMetadata, SkillStore} from '@core/skills/types'

export interface SkillsMiddlewareOptions {
  store: SkillStore
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

    async wrapModelCall(context: ModelCallContext, handler) {
      const skills = await discoverSkills(store)
      const sources = store.listSources?.() ?? []
      const skillsSection = SKILLS_SYSTEM_PROMPT
        .replace('{skills_locations}', formatSkillsLocations(sources))
        .replace('{skills_list}', formatSkillsList(skills, sources))
      const nextSystemMessage = context.systemMessage.concat(skillsSection)
      return handler({...context, systemMessage: nextSystemMessage})
    },
  })
}

async function discoverSkills(store: SkillStore): Promise<SkillMetadata[]> {
  try {
    return normalizeDiscoveredSkills(await store.discover())
  } catch {
    return []
  }
}

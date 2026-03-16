import {
  createMiddleware,
  type ModelCallContext
} from '@engine/pipeline/types'
import {
  SKILLS_SYSTEM_PROMPT,
  formatSkillsList,
  formatSkillsLocations,
} from '@capability/skill/metadata'
import {loadSkillsRuntimeData, readSkillsRuntimeData} from '@capability/skill/runtime'
import type {SkillsSource} from '@capability/skill'
import type {SkillStore} from '@capability/skill/types'

export interface SkillsMiddlewareOptions {
  store?: SkillStore
  source?: SkillsSource
  subagentRoots?: string[]
}

/**
 * Skills middleware: discover skills via store and inject into system prompt.
 *
 * The default Codara runtime injects skills through the session's SkillsSource
 * via `buildBaseSystemMessage()` instead of this middleware. Both approaches
 * produce the same result: metadata-only injection with progressive disclosure
 * (the model reads the full SKILL.md via Read tool when needed).
 *
 * This middleware is available for external consumers who want middleware-based
 * skills injection instead of the source-based approach.
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions) {
  const store = options.store
  const source = options.source

  return createMiddleware({
    name: 'SkillsMiddleware',

    async beforeModel(context: ModelCallContext) {
      const existingRuntime = readSkillsRuntimeData(context.runtime.shared)
      const runtime = existingRuntime ?? await loadRuntime()
      const skills = runtime.discovered
      const sources = runtime.sources
      const skillsSection = SKILLS_SYSTEM_PROMPT
        .replace('{skills_locations}', formatSkillsLocations(sources))
        .replace('{skills_list}', formatSkillsList(skills, sources))
      context.systemMessage.push(skillsSection)
      if (existingRuntime) {
        return undefined
      }
      return {
        runtimeShared: {
          skills: runtime
        }
      }
    },
  })

  async function loadRuntime() {
    if (source) {
      return source.getRuntime()
    }
    if (!store) {
      throw new Error('SkillsMiddleware requires either a skills store or a skills source')
    }
    return loadSkillsRuntimeData(store, options.subagentRoots ?? [])
  }
}

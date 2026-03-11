import {
  createMiddleware,
  type ModelCallContext
} from '@core/middleware'
import {
  SKILLS_SYSTEM_PROMPT,
  formatSkillsList,
  formatSkillsLocations,
} from '@core/instructions/skills/metadata'
import {loadSkillsRuntimeData, readSkillsRuntimeData} from '@core/instructions/skills/runtime'
import type {SkillsSource} from '@core/instructions/skills'
import type {SkillStore} from '@core/instructions/skills/types'

export interface SkillsMiddlewareOptions {
  store?: SkillStore
  source?: SkillsSource
  subagentRoots?: string[]
}

/**
 * Deepagents-style skills middleware:
 * - discover skills via store on model call
 * - inject skills system section in beforeModel
 *
 * Note:
 * - middleware does not keep run-level cache
 * - caching responsibility is delegated to store implementation
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

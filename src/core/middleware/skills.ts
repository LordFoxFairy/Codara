import {
  createMiddleware,
  type ModelCallContext
} from '@core/pipeline/types'
import {
  readSkillsRuntimeData,
  type SkillStore,
} from '@capability/skill'
import {createSkillTool} from '@capability/skill/runtime/commands'
import {loadSkillsRuntimeBundle, type SkillsRuntimeBundle} from '@context/skills/build'

export type SkillsRuntimeBundleLoader = (store: SkillStore, subagentRoots: string[]) => Promise<SkillsRuntimeBundle>

export interface SkillsMiddlewareOptions {
  /** Only needed for standalone usage (tests). Production reads from runtime shared. */
  store?: SkillStore
  subagentRoots?: string[]
  /** Injected loader for standalone mode. Avoids engine → capability import. */
  loadBundle?: SkillsRuntimeBundleLoader
}

/**
 * Skills middleware: provide the `Skill` tool for progressive disclosure.
 *
 * Production path: `buildBaseSystemMessage` already injects skill metadata
 * and runtime into `context.runtime.shared`. This middleware reads it and
 * only adds the Skill tool.
 *
 * Standalone path (tests): pass `store` to let the middleware discover,
 * inject system prompt, and provide the Skill tool.
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions = {}) {
  let cachedRuntime: SkillsRuntimeBundle['runtimeShared']['skills'] | undefined

  const skillTool = createSkillTool(() => cachedRuntime)

  return createMiddleware({
    name: 'SkillsMiddleware',
    tools: [skillTool],

    async beforeModel(context: ModelCallContext) {
      // Production: runtime already in shared from SkillsSource + buildBaseSystemMessage
      const existing = readSkillsRuntimeData(context.runtime.shared)
      if (existing) {
        cachedRuntime = existing
        return undefined
      }

      // Standalone: load from store and inject system prompt
      if (!options.store) {
        return undefined
      }
      const bundle = await (options.loadBundle ?? loadSkillsRuntimeBundle)(options.store, options.subagentRoots ?? [])
      cachedRuntime = bundle.runtimeShared.skills
      context.systemMessage.push(bundle.systemMessage)
      return {runtimeShared: bundle.runtimeShared}
    },
  })
}

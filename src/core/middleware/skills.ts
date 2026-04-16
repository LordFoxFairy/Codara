import type {StructuredToolInterface} from '@langchain/core/tools'
import {
  createMiddleware,
  type ModelCallContext
} from '@core/pipeline/types'
import type {SkillStore} from '@capability/skill/contracts'
import type {SkillsRuntimeBundle} from '@context/skills-bundle'

/** Runtime data read from shared context (type alias to avoid importing the full contract). */
export type SkillsRuntimeData = SkillsRuntimeBundle['runtimeShared']['skills']

export type SkillsRuntimeBundleLoader = (store: SkillStore, subagentRoots: string[]) => Promise<SkillsRuntimeBundle>

/** Function that reads skills runtime data from the shared context. */
export type SkillsRuntimeDataReader = (shared: unknown) => SkillsRuntimeData | undefined

/** Factory that creates the Skill tool given a runtime getter. */
export type SkillToolFactory = (getRuntime: () => SkillsRuntimeData | undefined) => StructuredToolInterface

export interface SkillsMiddlewareOptions {
  /** Only needed for standalone usage (tests). Production reads from runtime shared. */
  store?: SkillStore
  subagentRoots?: string[]
  /** Injected loader for standalone mode. Avoids core → capability import. */
  loadBundle?: SkillsRuntimeBundleLoader
  /** Injected reader for shared runtime data. Required — provided by the assembly layer. */
  readSkillsRuntimeData: SkillsRuntimeDataReader
  /** Injected factory to create the Skill tool. Required — provided by the assembly layer. */
  createSkillTool: SkillToolFactory
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
 *
 * Dependencies (`readSkillsRuntimeData`, `createSkillTool`) are injected
 * via options to avoid @core importing from @capability at runtime.
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions) {
  let cachedRuntime: SkillsRuntimeData | undefined

  const skillTool = options.createSkillTool(() => cachedRuntime)

  return createMiddleware({
    name: 'SkillsMiddleware',
    tools: [skillTool],

    async beforeModel(context: ModelCallContext) {
      // Production: runtime already in shared from SkillsSource + buildBaseSystemMessage
      const existing = options.readSkillsRuntimeData(context.runtime.shared)
      if (existing) {
        cachedRuntime = existing
        return undefined
      }

      // Standalone: load from store and inject system prompt
      if (!options.store || !options.loadBundle) {
        return undefined
      }
      const bundle = await options.loadBundle(options.store, options.subagentRoots ?? [])
      cachedRuntime = bundle.runtimeShared.skills
      context.systemMessage.push(bundle.systemMessage)
      return {runtimeShared: bundle.runtimeShared}
    },
  })
}

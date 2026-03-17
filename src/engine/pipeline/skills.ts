import {readFile} from 'node:fs/promises'
import {tool} from '@langchain/core/tools'
import {z} from 'zod'
import {
  createMiddleware,
  type ModelCallContext
} from '@engine/pipeline/types'
import {
  SKILLS_SYSTEM_PROMPT,
  formatSkillsList,
  formatSkillsLocations,
  readSkillsRuntimeData,
  type SkillsRuntimeData,
  type SkillMetadata,
  type SkillStore,
} from '@infra/context/skill-contracts'

export type SkillsRuntimeDataLoader = (store: SkillStore, subagentRoots: string[]) => Promise<SkillsRuntimeData>

export interface SkillsMiddlewareOptions {
  /** Only needed for standalone usage (tests). Production reads from runtime shared. */
  store?: SkillStore
  subagentRoots?: string[]
  /** Injected loader for standalone mode. Avoids engine → capability import. */
  loadRuntime?: SkillsRuntimeDataLoader
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
  let cachedRuntime: SkillsRuntimeData | undefined

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
      if (!options.store || !options.loadRuntime) {
        return undefined
      }
      const runtime = await options.loadRuntime(options.store, options.subagentRoots ?? [])
      cachedRuntime = runtime
      context.systemMessage.push(
        SKILLS_SYSTEM_PROMPT
          .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
          .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources)),
      )
      return {runtimeShared: {skills: runtime}}
    },
  })
}

// ── Skill tool ──────────────────────────────────────────────────────────

function createSkillTool(getRuntime: () => SkillsRuntimeData | undefined) {
  return tool(
    async ({skill: skillName, args: skillArgs}) => {
      const runtime = getRuntime()
      if (!runtime) {
        return 'Skills system not initialized yet. Try again after the first model turn.'
      }

      const match = findSkill(runtime.discovered, skillName)
      if (!match) {
        const available = runtime.discovered.map((s) => s.name).join(', ')
        return `Skill "${skillName}" not found. Available skills: ${available || '(none)'}`
      }

      let fullContent: string
      try {
        fullContent = await readFile(match.path, 'utf8')
      } catch {
        return `Could not read skill file: ${match.path}`
      }

      const parts = [`<command-name>${match.command?.name ?? match.name}</command-name>`, fullContent]
      if (skillArgs) {
        parts.push('', `User request: ${skillArgs}`)
      }
      return parts.join('\n')
    },
    {
      name: 'Skill',
      description: [
        'Execute a skill within the main conversation.',
        '',
        'When users ask you to perform tasks, check if any of the available skills match.',
        'Skills provide specialized capabilities and domain knowledge.',
        '',
        'When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"),',
        'they are referring to a skill. Use this tool to invoke it.',
        '',
        'How to invoke:',
        '- Use this tool with the skill name and optional arguments',
        '- Examples:',
        '  - skill: "commit" - invoke the commit skill',
        '  - skill: "review-pr", args: "123" - invoke with arguments',
        '',
        'Important:',
        '- Available skills are listed in system-reminder messages in the conversation',
        '- When a skill matches the user\'s request, this is a BLOCKING REQUIREMENT:',
        '  invoke the relevant Skill tool BEFORE generating any other response about the task',
        '- NEVER mention a skill without actually calling this tool',
        '- Do not invoke a skill that is already running',
      ].join('\n'),
      schema: z.object({
        skill: z.string().describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
        args: z.string().optional().describe('Optional arguments for the skill'),
      }),
    },
  )
}

function findSkill(discovered: SkillMetadata[], name: string): SkillMetadata | undefined {
  const lower = name.toLowerCase()
  return discovered.find((s) =>
    s.name === lower
    || s.command?.name === lower
    || s.command?.aliases?.includes(lower)
  )
}

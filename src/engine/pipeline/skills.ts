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
} from '@capability/skill/metadata'
import {
  loadSkillsRuntimeData,
  readSkillsRuntimeData,
  type SkillsRuntimeData,
} from '@capability/skill/runtime'
import type {SkillsSource} from '@capability/skill'
import type {SkillStore} from '@capability/skill/types'
import type {SkillMetadata} from '@capability/skill/types'

export interface SkillsMiddlewareOptions {
  store?: SkillStore
  source?: SkillsSource
  subagentRoots?: string[]
}

/**
 * Skills middleware: discover skills, inject metadata into system prompt,
 * and provide a `Skill` tool for progressive disclosure.
 *
 * The `Skill` tool lets the model load the full SKILL.md content on demand,
 * matching Claude Code's behavior. This guarantees complete skill loading
 * at the code level (not dependent on the model using Read correctly).
 *
 * When used alongside SkillsSource (which pre-injects metadata via
 * `buildBaseSystemMessage`), the middleware detects existing runtime data
 * and skips redundant system prompt injection — only the Skill tool is added.
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions) {
  const store = options.store
  const source = options.source

  // Mutable reference populated in beforeModel, read by the Skill tool handler.
  let cachedRuntime: SkillsRuntimeData | undefined

  const skillTool = tool(
    async ({skill: skillName, args: skillArgs}) => {
      if (!cachedRuntime) {
        return 'Skills system not initialized yet. Try again after the first model turn.'
      }

      const match = findSkill(cachedRuntime.discovered, skillName)
      if (!match) {
        const available = cachedRuntime.discovered.map((s) => s.name).join(', ')
        return `Skill "${skillName}" not found. Available skills: ${available || '(none)'}`
      }

      let fullContent: string
      try {
        fullContent = await readFile(match.path, 'utf8')
      } catch {
        return `Could not read skill file: ${match.path}`
      }

      // Wrap with <command-name> tag so the model knows the skill is loaded
      const parts = [
        `<command-name>${match.command?.name ?? match.name}</command-name>`,
        fullContent,
      ]
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

  return createMiddleware({
    name: 'SkillsMiddleware',
    tools: [skillTool],

    async beforeModel(context: ModelCallContext) {
      const existingRuntime = readSkillsRuntimeData(context.runtime.shared)
      const runtime = existingRuntime ?? await loadRuntime()
      cachedRuntime = runtime

      // Skip system prompt injection if SkillsSource already handled it
      // (existingRuntime set means buildBaseSystemMessage already injected metadata).
      if (!existingRuntime) {
        const skills = runtime.discovered
        const sources = runtime.sources
        const skillsSection = SKILLS_SYSTEM_PROMPT
          .replace('{skills_locations}', formatSkillsLocations(sources))
          .replace('{skills_list}', formatSkillsList(skills, sources))
        context.systemMessage.push(skillsSection)
      }

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

function findSkill(discovered: SkillMetadata[], name: string): SkillMetadata | undefined {
  const lower = name.toLowerCase()
  return discovered.find((s) =>
    s.name === lower
    || s.command?.name === lower
    || s.command?.aliases?.includes(lower)
  )
}

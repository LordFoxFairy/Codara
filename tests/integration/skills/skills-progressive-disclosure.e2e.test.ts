import {describe, expect, it} from 'bun:test'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages'
import type {BaseChatModel} from '@langchain/core/language_models/chat_models'
import type {StructuredToolInterface} from '@langchain/core/tools'
import {createAgentRunner} from '@core/agents'
import {createMiddleware} from '@core/middleware'
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills'

class ScriptedModel {
  readonly invocations: BaseMessage[][] = []

  constructor(private readonly response: AIMessage) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages)
    return this.response
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools
    return this
  }
}

describe('Skills Middleware Integration', () => {
  it('should inject deepagents-style skills prompt and keep custom frontmatter fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-integration-'))
    const skillName = 'analysis-skill'
    const skillDir = path.join(root, skillName)
    const skillPath = path.join(skillDir, 'SKILL.md')

    await mkdir(skillDir, {recursive: true})

    await writeFile(
      skillPath,
      `---
name: analysis-skill
description: Analyze a topic using staged references
allowed-tools:
  - read_file
custom-threshold: 0.75
custom-config:
  tier: gold
  region: cn
---
# Analysis Skill
Use references before final answer.
`,
      'utf8'
    )

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const discovered = await store.discover()

    expect(discovered).toHaveLength(1)
    expect(discovered[0]?.name).toBe(skillName)
    expect(discovered[0]?.extensions?.['custom-threshold']).toBe(0.75)
    expect((discovered[0]?.extensions?.['custom-config'] as {tier?: string})?.tier).toBe('gold')
    expect(discovered[0]?.frontmatter?.['custom-threshold']).toBe(0.75)

    const scriptedModel = new ScriptedModel(new AIMessage('done'))

    const systemPromptsByTurn = new Map<number, string>()
    const probeMiddleware = createMiddleware({
      name: 'SkillsProbe',
      wrapModelCall: async (request, handler) => {
        systemPromptsByTurn.set(request.turn, request.systemMessage.join('\n'))
        return handler(request)
      }
    })

    const runner = createAgentRunner({
      model: scriptedModel as unknown as BaseChatModel,
      tools: [],
      middlewares: [createSkillsMiddleware({store}), probeMiddleware]
    })

    const result = await runner.invoke({
      messages: [new HumanMessage('Use the skill before final answer.')]
    })

    expect(result.reason).toBe('complete')
    expect(result.turns).toBe(1)
    expect(scriptedModel.invocations).toHaveLength(1)

    const turn1System = systemPromptsByTurn.get(1) ?? ''
    expect(turn1System).toContain('Skills System')
    expect(turn1System).toContain(skillName)
    expect(turn1System).toContain(skillPath)
    expect(turn1System).toContain('Allowed tools: read_file')
  })
})

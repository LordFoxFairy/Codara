import {describe, expect, it} from 'bun:test'
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

describe('Project .codara skill integration', () => {
  it('should discover project skill and cooperate with probe middleware', async () => {
    const projectSkillsRoot = path.join(process.cwd(), '.codara', 'skills')
    const skillPath = path.join(projectSkillsRoot, 'basic-task-flow', 'SKILL.md')

    const store = new FileSystemSkillStore({sources: [projectSkillsRoot], cacheTtlMs: 0})
    const discovered = await store.discover()

    const skill = discovered.find((item) => item.name === 'basic-task-flow')
    expect(skill).toBeDefined()
    expect(skill?.path).toBe(skillPath)
    expect(skill?.metadata?.category).toBe('general')

    const scriptedModel = new ScriptedModel(new AIMessage('done'))

    const seenByProbe: string[] = []
    const probeMiddleware = createMiddleware({
      name: 'ProbeMiddleware',
      wrapModelCall: async (request, handler) => {
        seenByProbe.push(request.systemMessage.join('\n'))
        return handler(request)
      }
    })

    const runner = createAgentRunner({
      model: scriptedModel as unknown as BaseChatModel,
      tools: [],
      middlewares: [createSkillsMiddleware({store}), probeMiddleware]
    })

    const result = await runner.invoke({
      messages: [new HumanMessage('Use available skills if relevant.')]
    })

    expect(result.reason).toBe('complete')
    expect(scriptedModel.invocations).toHaveLength(1)

    const probeView = seenByProbe[0] ?? ''
    expect(probeView).toContain('Skills System')
    expect(probeView).toContain('basic-task-flow')
    expect(probeView).toContain(skillPath)
    expect(probeView).toContain('Allowed tools: read_file')
  })
})

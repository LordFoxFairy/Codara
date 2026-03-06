import {describe, expect, it} from 'bun:test'
import {access} from 'node:fs/promises'
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

describe('Project skills standard flow', () => {
  it('should discover standard skills, expose script asset, and cooperate with probe middleware', async () => {
    const projectSkillsRoot = path.join(process.cwd(), '.codara', 'skills')

    const basicSkillPath = path.join(projectSkillsRoot, 'basic-task-flow', 'SKILL.md')
    const diffSkillPath = path.join(projectSkillsRoot, 'repo-diff-check', 'SKILL.md')
    const diffScriptPath = path.join(projectSkillsRoot, 'repo-diff-check', 'scripts', 'check_diff.sh')

    const store = new FileSystemSkillStore({sources: [projectSkillsRoot], cacheTtlMs: 0})
    const discovered = await store.discover()

    const basicSkill = discovered.find((item) => item.name === 'basic-task-flow')
    const diffSkill = discovered.find((item) => item.name === 'repo-diff-check')

    expect(basicSkill).toBeDefined()
    expect(diffSkill).toBeDefined()

    expect(basicSkill?.path).toBe(basicSkillPath)
    expect(diffSkill?.path).toBe(diffSkillPath)
    expect(diffSkill?.metadata?.category).toBe('engineering')
    expect(diffSkill?.allowedTools).toEqual(['read_file', 'bash'])

    await access(diffScriptPath)

    const scriptedModel = new ScriptedModel(new AIMessage('done'))

    const probeSystemMessages: string[] = []
    const probeMiddleware = createMiddleware({
      name: 'ProbeMiddleware',
      wrapModelCall: async (request, handler) => {
        probeSystemMessages.push(request.systemMessage.join('\n'))
        return handler(request)
      }
    })

    const runner = createAgentRunner({
      model: scriptedModel as unknown as BaseChatModel,
      tools: [],
      middlewares: [createSkillsMiddleware({store}), probeMiddleware]
    })

    const result = await runner.invoke({
      messages: [new HumanMessage('Use appropriate project skills before answering.')]
    })

    expect(result.reason).toBe('complete')
    expect(scriptedModel.invocations).toHaveLength(1)

    const systemPromptSeenByProbe = probeSystemMessages[0] ?? ''
    expect(systemPromptSeenByProbe).toContain('Skills System')
    expect(systemPromptSeenByProbe).toContain('basic-task-flow')
    expect(systemPromptSeenByProbe).toContain('repo-diff-check')
    expect(systemPromptSeenByProbe).toContain(basicSkillPath)
    expect(systemPromptSeenByProbe).toContain(diffSkillPath)
  })
})

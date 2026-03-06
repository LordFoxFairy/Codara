import {describe, expect, it} from 'bun:test'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages'
import type {BaseChatModel} from '@langchain/core/language_models/chat_models'
import type {StructuredToolInterface} from '@langchain/core/tools'
import {tool} from '@langchain/core/tools'
import {z} from 'zod'
import {createAgentRunner} from '@core/agents'
import {createHILMiddleware, createMiddleware} from '@core/middleware'
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills'

class PauseAwareModel {
  private step = 0
  readonly invocations: BaseMessage[][] = []

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages)

    if (this.step === 0) {
      this.step += 1
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_perm', name: 'bash', args: {command: 'git status'}} as ToolCall]
      })
    }

    const joined = messages
      .map((message) => stringifyMessage(message.content))
      .join('\n')

    if (joined.includes('"type":"hil_pause"')) {
      return new AIMessage('PAUSED_BY_HIL')
    }

    return new AIMessage('NO_PAUSE')
  }

  bindTools(tools: StructuredToolInterface[]): this {
    void tools
    return this
  }
}

function stringifyMessage(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.map((item) => JSON.stringify(item)).join('\n')
  }
  return JSON.stringify(content)
}

describe('Skills + HIL permission guidance', () => {
  it('should use permission skill guidance and pause bash via generic HIL middleware', async () => {
    const projectSkillsRoot = path.join(process.cwd(), '.codara', 'skills')
    const store = new FileSystemSkillStore({sources: [projectSkillsRoot], cacheTtlMs: 0})

    const discovered = await store.discover()
    const permissionSkill = discovered.find((item) => item.name === 'permission-policy')

    expect(permissionSkill).toBeDefined()
    const skillRoot = path.dirname(permissionSkill?.path ?? '')
    expect(existsSync(path.join(skillRoot, 'scripts', 'evaluate-permission.sh'))).toBe(true)
    expect(existsSync(path.join(skillRoot, 'scripts', 'validate-settings.sh'))).toBe(true)

    let bashInvokeCount = 0
    const bashTool = tool(
      async ({command}: {command: string}) => {
        bashInvokeCount += 1
        return `executed:${command}`
      },
      {
        name: 'bash',
        description: 'Execute shell command',
        schema: z.object({command: z.string()})
      }
    )

    const model = new PauseAwareModel()

    const probeSystemMessages: string[] = []
    const probeMiddleware = createMiddleware({
      name: 'PermissionProbe',
      wrapModelCall: async (request, handler) => {
        probeSystemMessages.push(request.systemMessage.join('\n'))
        return handler(request)
      }
    })

    const hilMiddleware = createHILMiddleware({
      interruptOn: {bash: true}
    })

    const runner = createAgentRunner({
      model: model as unknown as BaseChatModel,
      tools: [bashTool],
      middlewares: [createSkillsMiddleware({store}), hilMiddleware, probeMiddleware]
    })

    const result = await runner.invoke({
      messages: [new HumanMessage('Need to run safe command according to permission policy.')]
    }, {recursionLimit: 4})

    expect(result.reason).toBe('complete')
    expect(model.invocations).toHaveLength(2)
    expect(bashInvokeCount).toBe(0)

    const finalMessage = result.state.messages[result.state.messages.length - 1]
    expect(String(finalMessage?.content)).toContain('PAUSED_BY_HIL')

    const firstProbeView = probeSystemMessages[0] ?? ''
    expect(firstProbeView).toContain('permission-policy')
    expect(firstProbeView).toContain('Allowed tools: read_file, bash')
  })
})

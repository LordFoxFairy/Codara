import {describe, expect, it} from 'bun:test'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {AIMessage, HumanMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages'
import type {BaseChatModel} from '@langchain/core/language_models/chat_models'
import type {StructuredToolInterface} from '@langchain/core/tools'
import {tool} from '@langchain/core/tools'
import {z} from 'zod'
import {createAgentRunner} from '@core/agents'
import {createMiddleware} from '@core/middleware'
import {createSkillsMiddleware, FileSystemSkillStore} from '@core/skills'

const DEBUG_LOG = process.env.SKILLS_E2E_LOG === '1'

function debugLog(message: string): void {
  if (!DEBUG_LOG) {
    return
  }
  process.stderr.write(`[skills-task-e2e] ${message}\n`)
}

class SkillAwareScriptedModel {
  private step = 0
  readonly invocations: BaseMessage[][] = []

  constructor(
    private readonly skillName: string,
    private readonly skillPath: string,
    private readonly referencePath: string
  ) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    this.invocations.push(messages)
    debugLog(`model invoke step=${this.step}, messages=${messages.length}`)

    const joined = messages
      .map((message) => stringifyMessage(message.content))
      .join('\n')

    if (this.step === 0) {
      // Prove skills middleware is effective: without injected skill context, model refuses workflow.
      if (!joined.includes(this.skillName) || !joined.includes(this.skillPath)) {
        debugLog('skills context missing in model prompt')
        return new AIMessage('SKILL_NOT_VISIBLE')
      }
      debugLog('skills context detected, reading SKILL.md')
      this.step += 1
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_skill', name: 'read_file', args: {path: this.skillPath}} as ToolCall]
      })
    }

    if (this.step === 1) {
      debugLog('skill file handled, reading reference file')
      this.step += 1
      return new AIMessage({
        content: '',
        tool_calls: [{id: 'call_ref', name: 'read_file', args: {path: this.referencePath}} as ToolCall]
      })
    }

    debugLog('task completed, returning TASK_DONE')
    return new AIMessage('TASK_DONE')
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

describe('Skills task completion flow', () => {
  it('should complete task when skills middleware exposes skill context', async () => {
    const projectSkillsRoot = path.join(process.cwd(), '.codara', 'skills')
    const skillPath = path.join(projectSkillsRoot, 'basic-task-flow', 'SKILL.md')
    const referencePath = path.join(projectSkillsRoot, 'basic-task-flow', 'references', 'checklist.md')

    const store = new FileSystemSkillStore({sources: [projectSkillsRoot], cacheTtlMs: 0})
    debugLog(`skills root: ${projectSkillsRoot}`)
    debugLog(`skill path: ${skillPath}`)
    debugLog(`reference path: ${referencePath}`)

    const model = new SkillAwareScriptedModel('basic-task-flow', skillPath, referencePath)

    const readFileTool = tool(
      async ({path: targetPath}: {path: string}) => {
        debugLog(`tool read_file -> ${targetPath}`)
        return readFile(targetPath, 'utf8')
      },
      {
        name: 'read_file',
        description: 'Read file content',
        schema: z.object({
          path: z.string()
        })
      }
    )

    const probeMiddleware = createMiddleware({
      name: 'TaskCompletionProbe',
      wrapModelCall: async (request, handler) => {
        debugLog(`wrapModelCall turn=${request.turn}, systemMessages=${request.systemMessage.length}`)
        return handler(request)
      },
      wrapToolCall: async (request, handler) => {
        debugLog(`wrapToolCall name=${request.toolCall.name}`)
        return handler(request)
      }
    })

    const runner = createAgentRunner({
      model: model as unknown as BaseChatModel,
      tools: [readFileTool],
      middlewares: [createSkillsMiddleware({store}), probeMiddleware]
    })

    const result = await runner.invoke({
      messages: [new HumanMessage('Please complete the task using project skill workflow.')]
    }, {recursionLimit: 6})

    expect(result.reason).toBe('complete')
    expect(result.turns).toBe(3)
    expect(model.invocations).toHaveLength(3)

    const finalMessage = result.state.messages[result.state.messages.length - 1]
    debugLog(`result reason=${result.reason}, turns=${result.turns}, final=${String(finalMessage?.content)}`)
    expect(String(finalMessage?.content)).toContain('TASK_DONE')
  })
})

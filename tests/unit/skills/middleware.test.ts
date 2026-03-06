import {describe, expect, it} from 'bun:test'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages'
import {
  createSkillsMiddleware,
  FileSystemSkillStore,
  type SkillMetadata,
  type SkillStore
} from '@core/skills'

function createBaseContext(runId: string) {
  const messages: BaseMessage[] = [new HumanMessage('hello')]
  return {
    state: {messages},
    messages,
    runtime: {context: {}},
    systemMessage: ['base-system'],
    runId,
    turn: 1,
    maxTurns: 3,
    requestId: `${runId}-req`
  }
}

function createTestStore(skills: SkillMetadata[]): SkillStore {
  return {
    async discover() {
      return skills
    },
    listSources() {
      return ['/tmp/user/.codara/skills', '/tmp/project/.codara/skills']
    }
  }
}

describe('createSkillsMiddleware', () => {
  it('should inject skills section into system prompt', async () => {
    const store = createTestStore([
      {
        name: 'demo-skill',
        description: 'do demo tasks',
        path: '/tmp/project/.codara/skills/demo-skill/SKILL.md',
        allowedTools: ['read_file']
      }
    ])
    const middleware = createSkillsMiddleware({store})
    const context = createBaseContext('run_prompt')

    let capturedSystemMessage: string[] = []
    await middleware.wrapModelCall?.(context, async (request = context) => {
      capturedSystemMessage = request.systemMessage
      return new AIMessage('ok')
    })

    const combined = capturedSystemMessage.join('\n')
    expect(combined).toContain('Skills System')
    expect(combined).toContain('demo-skill')
    expect(combined).toContain('/tmp/project/.codara/skills/demo-skill/SKILL.md')
    expect(combined).toContain('Allowed tools: read_file')
  })

  it('should work with real FileSystemSkillStore', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-skills-mw-'))
    const skillDir = path.join(root, 'demo-skill')
    await mkdir(skillDir, {recursive: true})
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: demo-skill
description: real store skill
allowed-tools:
  - read_file
custom-threshold: 0.8
---
# Demo
`,
      'utf8'
    )

    const store = new FileSystemSkillStore({sources: [root], cacheTtlMs: 0})
    const discovered = await store.discover()
    expect(discovered[0]?.extensions?.['custom-threshold']).toBe(0.8)

    const middleware = createSkillsMiddleware({store})
    const context = createBaseContext('run_real_store')

    let capturedSystemMessage: string[] = []
    await middleware.wrapModelCall?.(context, async (request = context) => {
      capturedSystemMessage = request.systemMessage
      return new AIMessage('ok')
    })

    expect(capturedSystemMessage.join('\n')).toContain('real store skill')
  })

  it('should delegate caching strategy to store and call discover per model call', async () => {
    let discoverCalls = 0
    const store: SkillStore = {
      async discover() {
        discoverCalls += 1
        return [
          {
            name: 'demo-skill',
            description: 'demo',
            path: '/tmp/project/.codara/skills/demo-skill/SKILL.md'
          }
        ]
      },
      listSources() {
        return ['/tmp/project/.codara/skills']
      }
    }

    const middleware = createSkillsMiddleware({store})
    const runId = 'run_store_cache'
    const context = createBaseContext(runId)

    await middleware.wrapModelCall?.(context, async () => new AIMessage('ok'))
    await middleware.wrapModelCall?.({...context, turn: 2, requestId: `${runId}-req-2`}, async () => new AIMessage('ok'))

    expect(discoverCalls).toBe(2)
  })
})

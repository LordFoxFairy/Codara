import {describe, test, expect, beforeEach} from 'bun:test'
import {
  createTeamContextMiddleware,
  readTeamContext,
  TEAM_CONTEXT_MIDDLEWARE_NAME,
} from '../../../src/engine/pipeline/team-context'
import type {TeamRuntimeContext} from '../../../src/engine/pipeline/team-context'
import type {BeforeModelContext} from '../../../src/engine/pipeline/types'

function createMockContext(teamContext?: TeamRuntimeContext): BeforeModelContext {
  return {
    state: {messages: []},
    messages: [],
    runtime: {
      context: {},
      shared: teamContext ? {teamContext} : undefined,
    },
    systemMessage: [],
    execution: {
      turn: 1,
      requestId: 'test-req',
      sessionId: 'test-session',
    },
  } as unknown as BeforeModelContext
}

function createMockTeamContext(overrides?: Partial<TeamRuntimeContext>): TeamRuntimeContext {
  return {
    teamId: 'team-1',
    memberId: 'member-1',
    memberName: 'worker-1',
    role: 'worker',
    teamName: 'test-team',
    goal: 'implement feature X',
    depth: 0,
    maxDepth: 2,
    drainInbox: async () => [],
    getProtocol: () => '# Worker Protocol\nYou are a worker.',
    ...overrides,
  }
}

describe('TeamContextMiddleware', () => {
  test('exports correct middleware name', () => {
    expect(TEAM_CONTEXT_MIDDLEWARE_NAME).toBe('TeamContextMiddleware')
  })

  test('has correct name property', () => {
    const mw = createTeamContextMiddleware()
    expect(mw.name).toBe('TeamContextMiddleware')
  })

  test('non-team session: systemMessage remains empty', async () => {
    const mw = createTeamContextMiddleware()
    const ctx = createMockContext() // no teamContext
    await mw.beforeModel!(ctx)
    expect(ctx.systemMessage).toEqual([])
  })

  test('team session first call: injects protocol prompt', async () => {
    const mw = createTeamContextMiddleware()
    const teamCtx = createMockTeamContext()
    const ctx = createMockContext(teamCtx)

    await mw.beforeModel!(ctx)

    expect(ctx.systemMessage).toContain('# Worker Protocol\nYou are a worker.')
  })

  test('team session subsequent calls: protocol NOT injected again', async () => {
    const mw = createTeamContextMiddleware()
    const teamCtx = createMockTeamContext()

    const ctx1 = createMockContext(teamCtx)
    await mw.beforeModel!(ctx1)
    expect(ctx1.systemMessage).toHaveLength(1)

    const ctx2 = createMockContext(teamCtx)
    await mw.beforeModel!(ctx2)
    expect(ctx2.systemMessage).toHaveLength(0)
  })

  test('inbox messages injected when present', async () => {
    const mw = createTeamContextMiddleware()
    const teamCtx = createMockTeamContext({
      drainInbox: async () => ['[leader] Please focus on tests', '[worker-2] Done with module A'],
    })

    // First call consumes protocol too, use second call for clean inbox test
    const ctx1 = createMockContext(teamCtx)
    await mw.beforeModel!(ctx1)

    // Verify inbox block is present
    const inboxMsg = ctx1.systemMessage.find((m) => m.includes('--- Team Inbox ---'))
    expect(inboxMsg).toBeDefined()
    expect(inboxMsg).toContain('[leader] Please focus on tests')
    expect(inboxMsg).toContain('[worker-2] Done with module A')
    expect(inboxMsg).toContain('--- End Inbox ---')
  })

  test('empty inbox: no inbox block added', async () => {
    const mw = createTeamContextMiddleware()
    const teamCtx = createMockTeamContext({drainInbox: async () => []})

    // Skip first call (protocol injection)
    const ctx1 = createMockContext(teamCtx)
    await mw.beforeModel!(ctx1)

    const ctx2 = createMockContext(teamCtx)
    await mw.beforeModel!(ctx2)

    // Second call: no protocol, no inbox → empty
    expect(ctx2.systemMessage).toHaveLength(0)
  })

  test('first call with inbox: both protocol and inbox in systemMessage', async () => {
    const mw = createTeamContextMiddleware()
    const teamCtx = createMockTeamContext({
      drainInbox: async () => ['[leader] Start now'],
    })

    const ctx = createMockContext(teamCtx)
    await mw.beforeModel!(ctx)

    expect(ctx.systemMessage).toHaveLength(2)
    expect(ctx.systemMessage[0]).toBe('# Worker Protocol\nYou are a worker.')
    expect(ctx.systemMessage[1]).toContain('--- Team Inbox ---')
    expect(ctx.systemMessage[1]).toContain('[leader] Start now')
  })
})

describe('readTeamContext', () => {
  test('returns context when present', () => {
    const teamCtx = createMockTeamContext()
    const ctx = createMockContext(teamCtx)
    expect(readTeamContext(ctx)).toBe(teamCtx)
  })

  test('returns undefined when shared is undefined', () => {
    const ctx = createMockContext()
    expect(readTeamContext(ctx)).toBeUndefined()
  })

  test('returns undefined when teamContext not in shared', () => {
    const ctx = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, shared: {otherKey: 'value'}},
      systemMessage: [],
      execution: {turn: 1, requestId: 'r', sessionId: 's'},
    } as unknown as BeforeModelContext
    expect(readTeamContext(ctx)).toBeUndefined()
  })
})

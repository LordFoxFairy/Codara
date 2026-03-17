/**
 * TeamContextMiddleware — team 上下文注入。
 *
 * 当 session 属于 team member 时，在 beforeModel 阶段注入：
 * 1. Team protocol 系统提示（仅首次 model call）
 * 2. Inbox 消息（每次 model call 都 drain）
 */

import {createMiddleware} from '@engine/pipeline/types'
import type {BaseMiddleware, BeforeModelContext} from '@engine/pipeline/types'

export const TEAM_CONTEXT_MIDDLEWARE_NAME = 'TeamContextMiddleware'

export interface TeamRuntimeContext {
  teamId: string
  memberId: string
  memberName: string
  role: 'leader' | 'worker' | 'reviewer'
  teamName: string
  goal: string
  depth: number
  maxDepth: number
  drainInbox: () => Promise<string[]>
  getProtocol: () => string
}

export function readTeamContext(context: BeforeModelContext): TeamRuntimeContext | undefined {
  return context.runtime.shared?.teamContext as TeamRuntimeContext | undefined
}

export function createTeamContextMiddleware(): BaseMiddleware {
  let protocolInjected = false

  return createMiddleware({
    name: TEAM_CONTEXT_MIDDLEWARE_NAME,

    async beforeModel(context) {
      const teamCtx = readTeamContext(context)
      if (!teamCtx) return

      // 1. 首次注入 protocol prompt
      if (!protocolInjected) {
        context.systemMessage.push(teamCtx.getProtocol())
        protocolInjected = true
      }

      // 2. Drain inbox 并注入消息
      const formattedMessages = await teamCtx.drainInbox()
      if (formattedMessages.length > 0) {
        const inboxBlock = [
          '--- Team Inbox ---',
          ...formattedMessages,
          '--- End Inbox ---',
        ].join('\n')
        context.systemMessage.push(inboxBlock)
      }
    },
  })
}

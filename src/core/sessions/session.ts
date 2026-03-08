import {randomUUID} from 'node:crypto';
import type {Agent} from '@core/agents';
import type {CreateSessionOptions, Session, SessionState, SessionStatus} from '@core/sessions/types';

/** 创建 session 宿主。 */
export function createSession(options: CreateSessionOptions): Session {
  const agent = options.agent;
  const sessionId = options.sessionId ?? randomUUID();
  const createdAt = new Date().toISOString();
  let updatedAt = createdAt;
  let sessionStatus: SessionStatus = 'ready';

  function touch(): void {
    updatedAt = new Date().toISOString();
  }

  function requireAgent(): Agent {
    if (sessionStatus === 'closed') {
      throw new Error('Session is closed.');
    }
    return agent;
  }

  return {
    getState(): SessionState {
      return {
        sessionId,
        threadId: agent.getState().threadId,
        sessionStatus,
        createdAt,
        updatedAt,
      };
    },
    agent(): Agent {
      touch();
      return requireAgent();
    },
    async reset(): Promise<void> {
      touch();
      await requireAgent().reset();
    },
    async dispose(): Promise<void> {
      if (sessionStatus === 'closed') {
        return;
      }
      await agent.dispose();
      sessionStatus = 'closed';
      touch();
    },
  };
}

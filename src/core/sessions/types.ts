import type {Agent} from '@core/agents';

/** Session 自身的生命周期状态。 */
export type SessionStatus = 'ready' | 'closed';

/** Session 对外暴露的宿主状态。 */
export interface SessionState {
  sessionId: string;
  threadId: string;
  sessionStatus: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Session 构造参数（内部使用）。 */
export interface CreateSessionOptions {
  sessionId?: string;
  agent: Agent;
}

/** Session 对外契约。 */
export interface Session {
  getState(): SessionState;
  agent(): Agent;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

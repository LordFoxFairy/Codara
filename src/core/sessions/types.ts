import type {Agent} from '@core/agents';
import type {CodaraMemory} from '@core/codara/memory';
import type {GuidelinesStore} from '@core/middleware/guidelines/store';

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
  memory?: CodaraMemory;
  guidelines?: GuidelinesStore;
}

/** Session 对外契约。 */
export interface Session {
  getState(): SessionState;
  agent(): Agent;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

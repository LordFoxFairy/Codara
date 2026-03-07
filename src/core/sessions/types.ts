import type {
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentRuntimeContext,
  AgentStateSnapshot,
  CreateAgentOptions,
} from '@core/agents';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {BaseMessage} from '@langchain/core/messages';

export type SessionQueryInput = AgentInput;
export type SessionQueryConfig = AgentInvokeConfig;
export type SessionResumeConfig = AgentResumeConfig;
export type SessionResumeStreamConfig = AgentResumeStreamConfig;
export type SessionState = AgentStateSnapshot;

/** Session 创建参数只负责实例种子，不承载 checkpoint 记录本身。 */
export interface CreateSessionOptions extends Omit<CreateAgentOptions, 'checkpoint'> {
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
}

/** Session 恢复依赖显式 threadId 与 checkpointer。 */
export interface LoadSessionOptions extends Omit<CreateAgentOptions, 'checkpoint' | 'state'> {
  threadId: string;
  checkpointer: AgentCheckpointer;
}

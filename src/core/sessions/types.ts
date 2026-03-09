import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInputBudget,
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStreamConfig,
  AgentStreamOutput,
} from '@core/agents';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {BaseMiddleware} from '@core/middleware';
import type {HILResumePayload} from '@core/middleware/hil';
import type {SourceProvider} from '@core/sessions/source-provider';
import type {CodaraModelCatalog} from '@core/codara/models';

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

/** Session 构造参数。 */
export interface CreateSessionOptions {
  sessionId?: string;
  threadId?: string;

  // Model 选择（二选一）
  alias?: string;  // 产品化的 alias（'default' / 'sonnet' / 'fast'）
  model?: BaseChatModel | Promise<BaseChatModel>;  // 直接传 model 实例

  // Model catalog（用于解析 alias）
  modelCatalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;

  // Source provider
  sourceProvider?: SourceProvider;

  // Agent 配置
  tools?: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  checkpointer?: AgentCheckpointer;

  // Checkpoint 恢复策略
  restore?: 'latest' | 'never';
  inputBudget?: AgentInputBudget;

  // 初始状态
  messages?: AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

/** Session 对外契约。 */
export interface Session {
  getState(): SessionState;
  getAgentState(): AgentState;

  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;

  reloadSources(): void;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

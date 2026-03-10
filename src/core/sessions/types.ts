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
import type {CompactOptions} from '@core/checkpoint/types';
import type {BaseMiddleware} from '@core/middleware';
import type {HILResumePayload} from '@core/middleware/hil';
import type {SourceProvider} from '@core/sessions/source-provider';
import type {SessionStore} from '@core/sessions/store';
import type {CodaraModelCatalog} from '@core/codara/models';

/** Session 自身的生命周期状态。 */
export type SessionStatus = 'ready' | 'closed';

/** Session 元数据 */
export interface SessionMetadata {
  /** Session 标题 */
  title?: string;
  /** 最后一条消息 */
  lastMessage?: string;
  /** 消息数量 */
  messageCount: number;
  /** 标签 */
  tags?: string[];
  /** 是否已归档 */
  archived?: boolean;
  /** 最后活动时间 */
  lastActivity: string;
}

/** Session 对外暴露的宿主状态。 */
export interface SessionState {
  sessionId: string;
  threadId: string;
  sessionStatus: SessionStatus;
  createdAt: string;
  updatedAt: string;
  /** Session 元数据 */
  metadata?: SessionMetadata;
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

  // Session store
  store?: SessionStore;

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
  hydrate(): Promise<AgentState>;

  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumePause(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumePauseStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;

  reloadSources(): void;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

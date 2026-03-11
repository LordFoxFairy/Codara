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
import type {ResumePayload} from '@core/agents/contract/pause';
import type {AgentsFileOverview, AgentsFileScope, AgentsSource} from '@core/sessions/agents';
import type {SkillsSource} from '@core/sessions/skills';
import type {SessionStore} from '@core/sessions/store';
import type {ModelInfo} from '@core/provider';

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
  /** 聚合后的模型用量统计 */
  usage?: {
    modelCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastPromptTokens?: number;
    lastCompletionTokens?: number;
    lastTotalTokens?: number;
  };
  /** 最近一次可见对话上下文占用 */
  contextWindow?: {
    maxInputTokens: number;
    availableInputTokens: number;
    estimatedInputTokens: number;
    usagePercent: number;
    overBudget: boolean;
  };
  /** fork 来源的 sessionId */
  forkedFromSessionId?: string;
  /** fork 来源的 threadId */
  forkedFromThreadId?: string;
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
export interface SessionModelCatalog {
  create(modelRef?: string): Promise<BaseChatModel>;
  getInfo(modelRef?: string): ModelInfo;
}

export interface CreateSessionOptions {
  /** 恢复或重新打开已存在 session 时可传入已持久化的宿主状态。 */
  state?: SessionState;
  sessionId?: string;
  threadId?: string;

  // Model 选择（二选一）
  modelRef?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;  // 直接传 model 实例

  // Model catalog（用于解析 modelRef）
  modelCatalog?: SessionModelCatalog | Promise<SessionModelCatalog>;

  // AGENTS source lifecycle
  agentsSource?: AgentsSource;
  skillsSource?: SkillsSource;

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
  metadata?: Partial<SessionMetadata>;
}

/** Session 对外契约。 */
export interface Session {
  getState(): SessionState;
  getAgentState(): AgentState;
  hydrate(): Promise<AgentState>;
  compactConversation(options?: {
    instructions?: string;
  }): Promise<AgentState>;
  fork(options?: {
    sessionId?: string;
    threadId?: string;
    store?: SessionStore;
  }): Promise<Session>;

  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumePauseStream(
    payload: ResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;

  reloadSources(): Promise<void>;
  inspectAgentsFiles(): Promise<AgentsFileOverview>;
  ensureAgentsFileTarget(scope: AgentsFileScope): Promise<string>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

import type {BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';
import type {HILPauseRequest, HILResumePayload} from '@core/middleware/hil';
import type {AgentCheckpoint, AgentCheckpointer, AgentCheckpointSummary} from '@core/checkpoint/state';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/contract/stream';

export type AgentRuntimeContext = Record<string, unknown>;

/**
 * Agent 运行时状态（对齐 LangChain/LangGraph 标准）
 *
 * messages 数组包含完整的对话历史，使用 LangChain 的 BaseMessage 类型：
 * - HumanMessage: 用户输入
 * - AIMessage: 模型响应（包含 tool_calls, usage_metadata, response_metadata）
 * - ToolMessage: 工具执行结果（包含 tool_call_id, artifact）
 * - SystemMessage: 系统提示
 *
 * 所有 LangChain 标准字段都会被保留和传递：
 * - content: string | Array<ContentBlock> （支持多模态）
 * - usage_metadata: token 使用统计
 * - response_metadata: 模型响应元数据
 * - additional_kwargs: 提供商特定信息
 */
export interface AgentState {
  messages: BaseMessage[];
}

/** 运行结束原因。 */
export type AgentFinishReason = 'complete' | 'error' | 'max_turns';

/** invoke/stream 返回的最终结果。 */
export interface AgentResult {
  reason: AgentFinishReason;
  state: AgentState;
  turns: number;
  error?: Error;
}

/** 用于恢复和 checkpoint 落盘的持久化快照。 */
export interface AgentStateSnapshot {
  threadId: string;
  checkpointId?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  status: 'idle' | 'running' | 'paused' | 'closed';
  pendingPause?: HILPauseRequest;
  lastResult?: AgentCheckpointSummary;
  step: number;
  createdAt: string;
  updatedAt: string;
}

/** createAgent(...) 时注入的初始运行态。 */
export interface AgentStateSeed {
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  pendingPause?: HILPauseRequest;
  checkpointId?: string;
  step?: number;
  createdAt?: string;
  updatedAt?: string;
  lastResult?: AgentCheckpointSummary;
  status?: AgentStateSnapshot['status'];
}

/** 工具异常处理策略。 */
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

/** 通用 agent 契约。 */
export interface Agent {
  getState(): AgentStateSnapshot;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
}

/** createAgent(...) 支持的构造参数。 */
export interface CreateAgentOptions {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  /** 工具异常处理：true=转成 ToolMessage，false=直接抛错，函数=自定义处理。 */
  handleToolErrors?: ToolErrorHandler;
  /** 中间件数组。 */
  middleware?: BaseMiddleware[];
  /** `middleware` 的复数别名。 */
  middlewares?: BaseMiddleware[];
  /** 可恢复运行使用的稳定 thread 标识。 */
  threadId?: string;
  /** 可选 checkpoint 存储。 */
  checkpointer?: AgentCheckpointer;
  /** 用于恢复运行态的已有 checkpoint。 */
  checkpoint?: AgentCheckpoint;
  /** 可选初始运行态。 */
  state?: AgentStateSeed;
}

/** invoke(...) 调用配置。 */
export interface AgentInvokeConfig {
  /** 最大 turn 数，默认 25。 */
  recursionLimit?: number;
  /** 中间件可见的运行时上下文。 */
  context?: AgentRuntimeContext;
  /** 是否在稳定边界持久化 checkpoint，默认 true。 */
  checkpoint?: boolean;
  /** 可选 beforeRun hook。 */
  beforeRun?: (context: {state: AgentState; runId: string; maxTurns: number}) => Promise<void> | void;
  /** 可选 afterRun hook。 */
  afterRun?: (context: {
    state: AgentState;
    runId: string;
    maxTurns: number;
    result: AgentResult;
  }) => Promise<void> | void;
}

export interface AgentResumeConfig extends Omit<AgentInvokeConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
}

export interface AgentResumeStreamConfig extends Omit<AgentStreamConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
}

export type AgentInput = AgentState | string | BaseMessage | BaseMessage[] | undefined;

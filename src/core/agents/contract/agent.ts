import type {BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';
import type {HILPauseRequest, HILResumePayload} from '@core/middleware/hil';
import type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint/state';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/contract/stream';

export type AgentRuntimeContext = Record<string, unknown>;
export type AgentRuntimeValues = Record<string, unknown>;
export type AgentStatus = 'idle' | 'running' | 'paused' | 'closed';
export type AgentType = 'main' | 'subagent';
export interface AgentInputBudget {
  maxInputTokens?: number;
  reservedTokens?: number;
}

/**
 * Agent 对外状态。
 *
 * messages 数组包含完整的对话历史，使用 LangChain 的 BaseMessage 类型：
 * - HumanMessage: 用户输入
 * - AIMessage: 模型响应（包含 tool_calls, usage_metadata, response_metadata）
 * - ToolMessage: 工具执行结果（包含 tool_call_id, artifact）
 * - SystemMessage: 系统提示
 *
 * 对外只暴露调用方真正需要的状态：
 * - threadId: 当前运行链标识
 * - messages: 当前对话历史
 * - status: 当前执行状态
 * - pendingPause: 当前未恢复的 HIL 暂停
 */
export interface AgentState {
  threadId: string;
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  status: AgentStatus;
  pendingPause?: HILPauseRequest;
}

/** invoke/stream 支持的最小消息输入。 */
export interface AgentMessagesInput {
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

/** 工具异常处理策略。 */
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

/** 通用 agent 契约。 */
export interface Agent {
  getState(): AgentState;
  compactConversation(config?: Pick<AgentInvokeConfig, 'context' | 'inputBudget'>): Promise<AgentState>;
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
  /** 当前 agent 的运行角色，默认 `main`。 */
  agentType?: AgentType;
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
  /** 初始对话历史。 */
  messages?: BaseMessage[];
  /** 初始运行上下文。 */
  context?: AgentRuntimeContext;
  /** 初始持久状态值（供 middleware state 使用）。 */
  values?: AgentRuntimeValues;
  /** 模型输入预算，用于 context compaction 等能力。 */
  inputBudget?: AgentInputBudget;
}

/** invoke(...) 调用配置。 */
export interface AgentInvokeConfig {
  /** 最大 turn 数，默认 25。 */
  recursionLimit?: number;
  /** 中间件可见的运行时上下文。 */
  context?: AgentRuntimeContext;
  /** 可选的本次调用输入预算覆盖。 */
  inputBudget?: AgentInputBudget;
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

export type AgentInput = AgentMessagesInput | string | BaseMessage | BaseMessage[] | undefined;

import type {AIMessage, AIMessageChunk, BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';
import type {AgentCheckpoint, AgentCheckpointer} from '@core/checkpoint';
import type {HILToolMessagePayload} from '@core/middleware/hil';

export type AgentRuntimeContext = Record<string, unknown>;
export type AgentRuntimeValues = Record<string, unknown>;
export type AgentStatus = 'idle' | 'running' | 'paused' | 'closed';
export type AgentType = 'main' | 'subagent';
export type ResumePayload = unknown;
export type AgentStreamMode = 'values' | 'updates' | 'messages' | 'custom';
export type AgentInput = AgentMessagesInput | string | BaseMessage | BaseMessage[] | undefined;
export type AgentFinishReason = 'complete' | 'error' | 'max_turns';
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

export interface AgentInputBudget { maxInputTokens?: number; reservedTokens?: number; }
export interface AgentExecutionMetadata {
  sessionId: string;
  runId: string;
  turn: number;
  maxTurns: number;
  requestId: string;
}

export interface PauseActionDescriptor {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface PauseUIActionOption {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  description?: string;
  scope?: string;
  requiresConfirmation?: boolean;
  requiresToolEdit?: boolean;
}

export interface PauseUIFormOption {
  id: string;
  label: string;
  description?: string;
}

export interface PauseUIFormTab {
  id: string;
  label: string;
  question: string;
  input?: 'select' | 'multiselect' | 'text' | 'mixed';
  options?: PauseUIFormOption[];
  placeholder?: string;
}

export interface PauseUIFormConfig {
  summary?: string;
  tabs: PauseUIFormTab[];
}

export interface PauseUIConfig {
  tab?: string;
  modal?: string;
  actions?: PauseUIActionOption[];
  form?: PauseUIFormConfig;
  [key: string]: unknown;
}

export type PauseReviewDecision = 'approve' | 'edit' | 'reject';

export interface PauseReviewRequest { actionName: string; allowedDecisions: PauseReviewDecision[]; }

export interface PauseRequest {
  id: string;
  description: string;
  action: PauseActionDescriptor;
  review: PauseReviewRequest;
  runtime: {
    runId: string;
    turn: number;
    requestId: string;
    toolIndex: number;
  };
  channel?: string;
  ui?: PauseUIConfig;
  metadata?: Record<string, unknown>;
}

export interface AgentTurnPreparationContext {
  state: {
    messages: BaseMessage[];
    context?: AgentRuntimeContext;
    values?: AgentRuntimeValues;
  };
  messages: BaseMessage[];
  runtime: {
    context: AgentRuntimeContext;
    runtimeContext?: AgentRuntimeContext;
    shared?: Record<string, unknown>;
  };
  systemMessage: string[];
  execution: AgentExecutionMetadata;
  inputBudget?: AgentInputBudget;
}

export type AgentTurnContextPreparer = (context: AgentTurnPreparationContext) => Promise<void> | void;

export interface AgentState {
  sessionId: string;
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  status: AgentStatus;
  pendingPause?: PauseRequest;
}

export interface AgentMessagesInput { messages: BaseMessage[]; }

export interface AgentResult {
  reason: AgentFinishReason;
  state: AgentState;
  turns: number;
  error?: Error;
}

export interface AgentStreamCustomChunk { type: 'hil_event'; runId: string; turn: number; payload: HILToolMessagePayload; }

export type AgentStreamOutput =
  | AIMessageChunk
  | {messages: BaseMessage[]}
  | {model: {messages: [AIMessage]}}
  | {tools: {messages: [ToolMessage]}}
  | AgentStreamCustomChunk
  | [AgentStreamMode, AIMessageChunk | {messages: BaseMessage[]} | {model: {messages: [AIMessage]}} | {tools: {messages: [ToolMessage]}} | AgentStreamCustomChunk];

export interface AgentInvokeConfig {
  recursionLimit?: number;
  context?: AgentRuntimeContext;
  inputBudget?: AgentInputBudget;
  checkpoint?: boolean;
  beforeRun?: (context: {state: AgentState; runId: string; maxTurns: number}) => Promise<void> | void;
  afterRun?: (context: {
    state: AgentState;
    runId: string;
    maxTurns: number;
    result: AgentResult;
  }) => Promise<void> | void;
}

export interface AgentStreamConfig extends Omit<AgentInvokeConfig, 'context'> {
  context?: AgentRuntimeContext;
  checkpoint?: boolean;
  streamMode?: AgentStreamMode | AgentStreamMode[];
}

export interface AgentResumeConfig extends Omit<AgentInvokeConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
  resumeMode?: 'model' | 'tool';
}
export interface AgentResumeStreamConfig extends Omit<AgentStreamConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
  resumeMode?: 'model' | 'tool';
}

export interface Agent {
  getState(): AgentState;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  resume(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumeStream(
    payload: ResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
}

export interface CreateAgentOptions {
  model: BaseChatModel;
  agentType?: AgentType;
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: BaseMiddleware[];
  sessionId?: string;
  checkpointer?: AgentCheckpointer;
  checkpoint?: AgentCheckpoint;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  systemMessage?: string[];
  runtimeShared?: Record<string, unknown>;
  inputBudget?: AgentInputBudget;
  prepareTurnContext?: AgentTurnContextPreparer;
}

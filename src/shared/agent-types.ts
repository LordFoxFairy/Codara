/**
 * Foundational agent types — no external dependencies (except langchain base).
 *
 * These live in shared so that both engine and capability layers
 * can depend on them without creating cross-layer cycles.
 */

import type {AIMessage, AIMessageChunk, BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';

// ── Primitive aliases ──

export type AgentRuntimeContext = Record<string, unknown>;
export type AgentRuntimeValues = Record<string, unknown>;
export type AgentStatus = 'idle' | 'running' | 'paused' | 'closed';
export type AgentType = 'main' | 'subagent';
export type ReviewResumePayload = unknown;

// ── Budget & Execution metadata ──

export interface AgentInputBudget {
  maxInputTokens?: number;
  reservedTokens?: number;
  keepRecentTurns?: number;
  maxCompactionAttempts?: number;
}

export interface AgentExecutionMetadata {
  sessionId: string;
  runId: string;
  turn: number;
  maxTurns: number;
  requestId: string;
}

// ── Review system ──

export interface ReviewActionDescriptor {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface ReviewUIActionOption {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
  description?: string;
  scope?: string;
  requiresConfirmation?: boolean;
  requiresToolEdit?: boolean;
}

export interface ReviewUIFormOption {
  id: string;
  label: string;
  description?: string;
}

export interface ReviewUIFormTab {
  id: string;
  label: string;
  question: string;
  input?: 'select' | 'multiselect' | 'text';
  options?: ReviewUIFormOption[];
  placeholder?: string;
}

export interface ReviewUIFormConfig {
  summary?: string;
  tabs: ReviewUIFormTab[];
}

export interface ReviewUIConfig {
  tab?: string;
  modal?: string;
  actions?: ReviewUIActionOption[];
  form?: ReviewUIFormConfig;
  [key: string]: unknown;
}

export type ReviewDecision = 'approve' | 'edit' | 'reject';

export interface ReviewSpec {
  actionName: string;
  allowedDecisions: ReviewDecision[];
}

export interface ReviewRequest {
  id: string;
  description: string;
  action: ReviewActionDescriptor;
  review: ReviewSpec;
  runtime: {
    runId: string;
    turn: number;
    requestId: string;
    toolIndex: number;
  };
  channel?: string;
  ui?: ReviewUIConfig;
  metadata?: Record<string, unknown>;
}

// ── Agent state & result ──

export type AgentFinishReason = 'complete' | 'error' | 'max_turns' | 'budget_exhausted' | 'aborted';

export interface AgentState {
  sessionId: string;
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  status: AgentStatus;
  pendingReview?: ReviewRequest;
}

export interface AgentResult {
  reason: AgentFinishReason;
  state: AgentState;
  turns: number;
  error?: Error;
  launchedSubagentBatchIds?: string[];
}

// ── Agent input & config ──

export type AgentInput = AgentMessagesInput | string | BaseMessage | BaseMessage[] | undefined;
export interface AgentMessagesInput { messages: BaseMessage[]; }
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

export interface AgentInvokeConfig {
  recursionLimit?: number;
  context?: AgentRuntimeContext;
  inputBudget?: AgentInputBudget;
  checkpoint?: boolean;
  signal?: AbortSignal;
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

// ── Streaming ──

export type AgentStreamMode = 'values' | 'updates' | 'messages' | 'custom';

export type ReviewToolMessagePayload =
  | {
      type: 'review_pause';
      request: ReviewRequest;
    }
  | {
      type: 'review_deny';
      reason: string;
      metadata: Record<string, unknown>;
      action: {
        toolCallId: string;
        toolName: string;
      };
    };

export type AgentStreamCustomChunk =
  | { type: 'review_event'; runId: string; turn: number; payload: ReviewToolMessagePayload }
  | { type: 'tool_progress'; toolCallId: string; toolName: string; status: 'executing' | 'completed' | 'failed' };

export type AgentStreamOutput =
  | AIMessageChunk
  | {messages: BaseMessage[]}
  | {model: {messages: [AIMessage]}}
  | {tools: {messages: [ToolMessage]}}
  | AgentStreamCustomChunk
  | [AgentStreamMode, AIMessageChunk | {messages: BaseMessage[]} | {model: {messages: [AIMessage]}} | {tools: {messages: [ToolMessage]}} | AgentStreamCustomChunk];

// ── Context preparation ──

/** Agent context assembled immediately before the next model call. */
export interface AgentPreparationContext {
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

export type AgentContextPreparer = (context: AgentPreparationContext) => Promise<void> | void;

// ── Agent interface ──

export interface Agent {
  getState(): AgentState;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  resume(payload: ReviewResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
  stream(input?: AgentInput, config?: AgentStreamConfig): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resumeStream(
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  /** Abort the currently running agent loop. No-op if the agent is not running. */
  abort(): void;
}

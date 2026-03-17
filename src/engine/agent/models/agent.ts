import type {AIMessage, AIMessageChunk, BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@engine/pipeline/types';
import type {AgentCheckpoint, AgentCheckpointer} from '@infra/checkpoint/agent';
import type {HILToolMessagePayload} from '@engine/pipeline/hil';
import type {AgentLifecycleHooks} from '@engine/hook/types';
import type {
  AgentExecutionMetadata,
  AgentFinishReason,
  AgentInputBudget,
  AgentResult,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentState,
  AgentStatus,
  AgentType,
  PauseRequest,
  ResumePayload,
} from './types';
export type {
  AgentExecutionMetadata,
  AgentFinishReason,
  AgentInputBudget,
  AgentResult,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentState,
  AgentStatus,
  AgentType,
  PauseRequest,
  PauseActionDescriptor,
  PauseReviewDecision,
  PauseReviewRequest,
  PauseUIActionOption,
  PauseUIConfig,
  PauseUIFormConfig,
  PauseUIFormOption,
  PauseUIFormTab,
  ResumePayload,
} from './types';

export type AgentStreamMode = 'values' | 'updates' | 'messages' | 'custom';
export type AgentInput = AgentMessagesInput | string | BaseMessage | BaseMessage[] | undefined;
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

/** Current agent context assembled immediately before the next model call. */
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

export interface AgentMessagesInput { messages: BaseMessage[]; }

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
  prepareContext?: AgentContextPreparer;
  lifecycle?: AgentLifecycleHooks;
}

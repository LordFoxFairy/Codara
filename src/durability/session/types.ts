// ── Transcript Types (moved from src/session/) ──

export interface TranscriptEntry {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'attachment';
  uuid: string;
  parentUuid?: string;
  timestamp: number;
  content: unknown;
  metadata?: {
    model?: string;
    tokens?: number;
    toolName?: string;
    subtype?: string;  // e.g., 'compact_boundary'
  };
}

export interface TranscriptSessionMetadata {
  sessionId: string;
  projectRoot: string;
  createdAt: number;
  model?: string;
  title?: string;
}

// ── Agent / Session Types ──

import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMessage} from '@langchain/core/messages';
import type {
  Agent,
  AgentContextPreparer,
  AgentInput,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentRuntimeValues,
  ToolErrorHandler,
} from '@shared/agent-types';
import type {AgentCheckpointer, AgentCheckpoint} from '@durability/checkpoint/agent';

// ── Agent Factory ──

/**
 * Abstracts agent creation and input normalization so the session layer
 * does not depend on @core/agent directly.
 */
export interface AgentFactory {
  /** Create an agent instance from the given options. */
  create(options: AgentFactoryCreateOptions): Promise<Agent>;
  /** Convert loose AgentInput to a BaseMessage array. */
  normalizeInput(input: AgentInput): BaseMessage[];
}

/**
 * Options passed by the session to the factory when bootstrapping an agent.
 * Mirrors the subset of BootstrapAgentOptions that the session assembles.
 */
export interface AgentFactoryCreateOptions {
  model: BaseChatModel;
  agentType?: 'main' | 'subagent';
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: unknown[];
  checkpointer?: AgentCheckpointer;
  checkpoint?: AgentCheckpoint;
  sessionId?: string;
  inputBudget?: AgentInputBudget;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  systemMessage?: string[];
  runtimeShared?: Record<string, unknown>;
  prepareContext?: AgentContextPreparer;
}

// ── Middleware Factory ──

/**
 * Abstracts middleware assembly for the session so that @core/pipeline and
 * @core/middleware imports stay in the codara/engine layer.
 */
export interface SessionMiddlewareFactory {
  /** Well-known middleware names used for dedup/ordering. */
  middlewareNames: {Summary: string; Review: string};
  /** Build a summary middleware, or undefined when summary is disabled. */
  createSummaryMiddleware(settings: unknown): unknown | undefined;
  /** Resolve summary settings into the required internal options. */
  resolveSummaryOptions(settings: unknown, model: BaseChatModel): unknown | undefined;
  /** Compact a conversation using a summary generator. */
  compactConversation(input: unknown, summary: unknown): Promise<{messages: BaseMessage[]; context: AgentRuntimeContext; values: AgentRuntimeValues} | undefined>;
}

// ── Session Types ──

export type SessionStatus = 'ready' | 'closed';

export interface SessionMetadata {
  title?: string;
  lastMessage?: string;
  messageCount: number;
  tags?: string[];
  archived?: boolean;
  /** When true, this session is internal (e.g. delegated subagent or helper session) and hidden from /resume. */
  internal?: boolean;
  lastActivity: string;
  usage?: {
    modelCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastPromptTokens?: number;
    lastCompletionTokens?: number;
    lastTotalTokens?: number;
  };
  contextWindow?: {
    maxInputTokens: number;
    availableInputTokens: number;
    estimatedInputTokens: number;
    usagePercent: number;
    overBudget: boolean;
  };
  forkedFromSessionId?: string;
}

export interface SessionState {
  sessionId: string;
  sessionStatus: SessionStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: SessionMetadata;
}

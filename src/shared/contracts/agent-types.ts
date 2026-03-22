/**
 * Foundational agent types — no external dependencies (except langchain base).
 *
 * These live in shared so that both engine and capability layers
 * can depend on them without creating cross-layer cycles.
 */

import type {BaseMessage} from '@langchain/core/messages';

export type AgentRuntimeContext = Record<string, unknown>;
export type AgentRuntimeValues = Record<string, unknown>;
export type AgentStatus = 'idle' | 'running' | 'paused' | 'closed';
export type AgentType = 'main' | 'subagent';
export type ReviewResumePayload = unknown;

export interface AgentInputBudget {
  maxInputTokens?: number;
  reservedTokens?: number;
}

export interface AgentExecutionMetadata {
  sessionId: string;
  runId: string;
  turn: number;
  maxTurns: number;
  requestId: string;
}

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

export type AgentFinishReason = 'complete' | 'error' | 'max_turns';

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
}

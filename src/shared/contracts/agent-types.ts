/**
 * Foundational agent types — no external dependencies.
 *
 * These live in shared so that both engine and capability layers
 * can depend on them without creating cross-layer cycles.
 */

export type AgentRuntimeContext = Record<string, unknown>;
export type AgentRuntimeValues = Record<string, unknown>;
export type AgentStatus = 'idle' | 'running' | 'paused' | 'closed';
export type AgentType = 'main' | 'subagent';
export type ResumePayload = unknown;

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

export interface PauseReviewRequest {
  actionName: string;
  allowedDecisions: PauseReviewDecision[];
}

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

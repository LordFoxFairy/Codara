export type SessionStatus = 'ready' | 'closed';

export interface SessionMetadata {
  title?: string;
  lastMessage?: string;
  messageCount: number;
  tags?: string[];
  archived?: boolean;
  /** When true, this session is internal (e.g. delegated task or team worker) and hidden from /resume. */
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

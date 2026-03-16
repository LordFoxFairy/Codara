/**
 * Cross-cutting execution context types — no external dependencies.
 *
 * These are used by both engine (pipeline, budget) and capability (task delegation)
 * layers, so they live in shared to prevent cross-layer imports.
 */

export interface ExecutionContextMetadata {
  sessionId: string;
  runId: string;
  turn: number;
  maxTurns: number;
  requestId: string;
  toolIndex?: number;
  toolCallId?: string;
}

export interface ContextBudgetSnapshot {
  maxInputTokens: number;
  reservedTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  overBudget: boolean;
}

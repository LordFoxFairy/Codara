/**
 * Cross-cutting execution context types — no external dependencies.
 *
 * These are used by both engine (pipeline, budget) and capability (task delegation)
 * layers, so they live in shared to prevent cross-layer imports.
 */

import type {AgentExecutionMetadata} from '@shared/agent-types';

/**
 * Execution metadata extended with tool-level coordinates.
 * Superset of AgentExecutionMetadata — adds toolIndex and toolCallId
 * so middleware can identify exactly which tool invocation is running.
 */
export interface ExecutionContextMetadata extends AgentExecutionMetadata {
  toolIndex?: number;
  toolCallId?: string;
}

export interface ContextBudgetSnapshot {
  maxInputTokens: number;
  reservedTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  usagePercent: number;
  overBudget: boolean;
}

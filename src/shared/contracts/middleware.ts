/**
 * Middleware contracts — cross-context type definitions for the middleware system.
 */

// Re-export from the canonical source to maintain single source of truth
export type {
  BaseMiddleware,
  BaseExecutionContext,
  MiddlewareRuntimeContext,
  MiddlewareRuntimeShared,
  BeforeAgentContext,
  BeforeModelContext,
  ModelCallContext,
  AfterModelContext,
  ToolCallContext,
  AfterAgentContext,
  AgentRunSummary,
  ModelCallHandler,
  ToolCallHandler,
} from '@core/pipeline/types';

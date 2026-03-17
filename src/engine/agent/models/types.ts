/**
 * Agent types — re-exported from shared/contracts for backwards compatibility.
 *
 * All canonical definitions now live in @shared/contracts/agent-types
 * to eliminate cross-layer dependency cycles.
 */
export type {
  AgentExecutionMetadata,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentStatus,
  AgentType,
  PauseActionDescriptor,
  PauseReviewDecision,
  PauseReviewRequest,
  PauseRequest,
  PauseUIActionOption,
  PauseUIConfig,
  PauseUIFormConfig,
  PauseUIFormOption,
  PauseUIFormTab,
  ResumePayload,
} from '@shared/contracts/agent-types';

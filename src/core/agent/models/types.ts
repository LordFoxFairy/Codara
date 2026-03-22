/**
 * Agent types — re-exported from shared/contracts for backwards compatibility.
 *
 * All canonical definitions now live in @shared/contracts/agent-types
 * to eliminate cross-layer dependency cycles.
 */
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
  ReviewActionDescriptor,
  ReviewDecision,
  ReviewSpec,
  ReviewRequest,
  ReviewUIActionOption,
  ReviewUIConfig,
  ReviewUIFormConfig,
  ReviewUIFormOption,
  ReviewUIFormTab,
  ReviewResumePayload,
} from '@shared/contracts/agent-types';

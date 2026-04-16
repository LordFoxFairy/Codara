/**
 * Adapter layer: consolidates all @core and @durability dependencies into a single file.
 * This makes cross-layer coupling explicit and contained.
 *
 * All subagent modules import from here instead of reaching into @core/* or @durability/* directly.
 */

// --- @core/pipeline/types ---
export {
  createMiddleware,
  MIDDLEWARE_NAMES,
  type BaseMiddleware,
  type BeforeModelContext,
  type ToolCallContext,
  type ExecutionContextMetadata,
} from '@core/pipeline/types';

// --- @core/agent/models/agent ---
export type {
  Agent,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentContextPreparer,
  AgentRuntimeValues,
  AgentPreparationContext,
  ToolErrorHandler,
  ReviewResumePayload,
} from '@core/agent/models/agent';

// --- @core/agent (barrel) ---
export type {
  AgentResumeStreamConfig,
  AgentStreamOutput,
  ReviewRequest,
} from '@core/agent';

// --- @core/agent/bootstrap ---
export {bootstrapAgent, type BootstrapAgentOptions} from '@core/agent/bootstrap';

// --- @core/agent/run/tool-executor ---
export {resolveToolCallId} from '@core/agent/run/tool-executor';

// --- @core/middleware ---
export {
  createAskUserQuestionMiddleware,
  createBudgetMiddleware,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createTodoListMiddleware,
  type ReviewMiddlewareOptions,
  type LoggingMiddlewareOptions,
} from '@core/middleware';
export type {PermissionMiddlewareOptions} from '@core/middleware/permission/middleware';

// --- @durability/checkpoint/agent ---
export {createAgentMemoryCheckpointer, type AgentCheckpointer} from '@durability/checkpoint/agent';

// --- @durability/approval-store ---
export type {ApprovalRecord, ApprovalStore} from '@durability/approval-store';

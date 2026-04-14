import {createMiddleware, type ToolCallContext} from '@core/pipeline/types';
import type {
  ReviewActionDescriptor as SharedReviewActionDescriptor,
  ReviewRequest as SharedReviewRequest,
  ReviewDecision as ReviewDecisionValue,
  ReviewUIActionOption as SharedReviewUIActionOption,
  ReviewUIConfig,
  ReviewResumePayload as SharedReviewResumePayload,
} from '@shared/contracts/agent-types';

// Re-export evaluator functions used by external consumers
export {
  defaultDecisionResolver,
  normalizeAllowedDecisions,
  normalizeResumeDecision,
  isReviewDecisionValue,
} from './review-evaluator';

// Re-export payload functions used by external consumers
export {
  applyReviewResumeToolEdits,
  createDefaultResumeHandler,
  defaultDenyMessageFactory,
  defaultResumeResolver,
  defaultReviewMessageFactory,
  defaultReviewRequestFactory,
  noopReviewNotifier,
  parseReviewResumeActionPayload,
  parseReviewToolMessagePayload,
  resolveToolCallId,
} from './review-payload';

// Internal imports for middleware orchestration
import {
  resolveEffectiveConfig,
  resolveInterruptConfig,
  normalizeDecision,
  resolveAskConfig,
  defaultDecisionResolver,
  DEFAULT_DESCRIPTION_PREFIX,
} from './review-evaluator';
import {
  defaultReviewRequestFactory,
  noopReviewNotifier,
  defaultResumeResolver,
  createDefaultResumeHandler,
  defaultReviewMessageFactory,
  defaultDenyMessageFactory,
} from './review-payload';

export type ReviewActionDescriptor = SharedReviewActionDescriptor;
export type ReviewRequest = SharedReviewRequest;
export type ReviewUIActionOption = SharedReviewUIActionOption;
export type ReviewResumePayload = SharedReviewResumePayload;

export type ReviewToolMessagePayload =
  | {
      type: 'review_pause';
      request: ReviewRequest;
    }
  | {
      type: 'review_deny';
      reason: string;
      metadata: Record<string, unknown>;
      action: {
        toolCallId: string;
        toolName: string;
      };
    };

export type ReviewDescriptionFactory = (
  toolCall: import('@langchain/core/messages').ToolCall,
  state: ToolCallContext['state'],
  runtime: ToolCallContext['runtime']
) => string | Promise<string>;

export interface ReviewInterruptConfig {
  description?: string | ReviewDescriptionFactory;
  channel?: string;
  ui?: ReviewUIConfig;
  metadata?: Record<string, unknown>;
  allowedDecisions?: ReviewDecisionValue[];
}

export type ReviewInterruptOn = Record<string, boolean | ReviewInterruptConfig>;

export interface ReviewContextConfig {
  interruptOn?: ReviewInterruptOn;
  descriptionPrefix?: string;
}

/**
 * Generic resume payload shape used by higher-level interaction layers.
 * `scope` is intentionally opaque to Review so approval persistence can stay
 * in project policy or other external stores.
 */
export interface ReviewResumeActionPayload {
  decision?: ReviewDecisionValue;
  action?: string;
  scope?: string;
  comment?: string;
  editedToolName?: string;
  editedToolArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ReviewEffectiveConfig {
  interruptOn?: ReviewInterruptOn;
  descriptionPrefix: string;
}

export interface ReviewDecisionContext {
  context: ToolCallContext;
  effectiveConfig: ReviewEffectiveConfig;
  interruptConfig: ReviewInterruptConfig | null;
}

export interface ReviewAllowDecision {
  decision: 'allow';
}

export interface ReviewAskDecision {
  decision: 'ask';
  config?: ReviewInterruptConfig;
  metadata?: Record<string, unknown>;
}

export interface ReviewDenyDecision {
  decision: 'deny';
  reason?: string;
  metadata?: Record<string, unknown>;
  message?: import('@langchain/core/messages').ToolMessage;
}

export type ReviewDecision = ReviewAllowDecision | ReviewAskDecision | ReviewDenyDecision;

export type ReviewDecisionResolver = (
  input: ReviewDecisionContext
) => Promise<ReviewDecision | undefined> | ReviewDecision | undefined;

export type ReviewRequestFactory = (
  context: ToolCallContext,
  config: ReviewInterruptConfig,
  descriptionPrefix: string
) => Promise<ReviewRequest> | ReviewRequest;

export type ReviewNotifier = (request: ReviewRequest, context: ToolCallContext) => Promise<void> | void;

export type ReviewResumeResolver = (
  request: ReviewRequest,
  context: ToolCallContext
) => Promise<ReviewResumePayload | undefined> | ReviewResumePayload | undefined;

export type ReviewResumeHandler = (
  request: ReviewRequest,
  resumePayload: ReviewResumePayload,
  context: ToolCallContext,
  handler: (request?: ToolCallContext) => Promise<import('@langchain/core/messages').ToolMessage>
) => Promise<import('@langchain/core/messages').ToolMessage>;

export type ReviewMessageFactory = (request: ReviewRequest, context: ToolCallContext) => import('@langchain/core/messages').ToolMessage;

export type ReviewDenyMessageFactory = (decision: ReviewDenyDecision, context: ToolCallContext) => import('@langchain/core/messages').ToolMessage;

export interface ReviewMiddlewareOptions extends ReviewContextConfig {
  enabled?: boolean;
  name?: string;
  resolveDecision?: ReviewDecisionResolver;
  buildReviewRequest?: ReviewRequestFactory;
  onPause?: ReviewNotifier;
  resolveResume?: ReviewResumeResolver;
  handleResume?: ReviewResumeHandler;
  createReviewMessage?: ReviewMessageFactory;
  createDenyMessage?: ReviewDenyMessageFactory;
}

const DEFAULT_NAME = 'ReviewMiddleware';

/**
 * Generic review middleware.
 *
 * Design goal:
 * - Middleware is only responsible for pause/resume interception.
 * - Any concrete interaction protocol (approval/edit/reject, multipage UI, tab workflow)
 *   is implemented outside via `resolveDecision` / `resolveResume` / `handleResume` hooks.
 */
export function createReviewMiddleware(options: ReviewMiddlewareOptions = {}) {
  const name = options.name?.trim() || DEFAULT_NAME;
  const enabled = options.enabled ?? true;

  const resolveDecision = options.resolveDecision ?? defaultDecisionResolver;
  const buildReviewRequest = options.buildReviewRequest ?? defaultReviewRequestFactory;
  const onPause = options.onPause ?? noopReviewNotifier;
  const resolveResume = options.resolveResume ?? defaultResumeResolver;
  const createReviewMessage = options.createReviewMessage ?? defaultReviewMessageFactory;
  const createDenyMessage = options.createDenyMessage ?? defaultDenyMessageFactory;
  const handleResume = options.handleResume ?? createDefaultResumeHandler(createDenyMessage);

  return createMiddleware({
    name,
    async wrapToolCall(context, handler) {
      if (!enabled) {
        return handler(context);
      }

      const effectiveConfig = resolveEffectiveConfig(options, context.runtime.context);
      const interruptConfig = resolveInterruptConfig(context.toolCall.name, effectiveConfig.interruptOn);

      const decisionInput: ReviewDecisionContext = {
        context,
        effectiveConfig,
        interruptConfig,
      };
      const rawDecision = await resolveDecision(decisionInput);
      const decision = normalizeDecision(rawDecision, interruptConfig);

      if (decision.decision === 'allow') {
        return handler(context);
      }

      if (decision.decision === 'deny') {
        return decision.message ?? createDenyMessage(decision, context);
      }

      const askConfig = resolveAskConfig(decision, interruptConfig);
      const request = await buildReviewRequest(context, askConfig, effectiveConfig.descriptionPrefix);
      const resumePayload = await resolveResume(request, context);

      if (resumePayload !== undefined) {
        return handleResume(request, resumePayload, context, handler);
      }

      await onPause(request, context);
      return createReviewMessage(request, context);
    },
  });
}

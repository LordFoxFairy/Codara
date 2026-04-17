/**
 * Review middleware — pause/resume interception for tool calls.
 *
 * Only responsible for pause/resume orchestration. Concrete interaction
 * protocols (approval/edit/reject, permission prompts, AskUser forms) are
 * implemented outside via resolveDecision / resolveResume / handleResume hooks.
 *
 * Default factories + config helpers live in `./review-defaults`; payload
 * parsing + edit application in `./review-payload`.
 */

import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type ToolCallContext} from '@core/pipeline-types';
import type {ReviewRequest, ReviewResumePayload} from '@shared/agent-types';
import {
  applyReviewResumeToolEdits,
  parseReviewResumeActionPayload,
  readReviewContext,
  readRecord,
} from './review-payload';
import {
  defaultDenyMessageFactory,
  defaultReviewMessageFactory,
  defaultReviewRequestFactory,
  normalizeDecision,
  resolveAskConfig,
  resolveEffectiveConfig,
  resolveInterruptConfig,
  type ReviewDecision,
  type ReviewDenyDecision,
  type ReviewInterruptConfig,
  type ReviewInterruptOn,
} from './review-defaults';

// Re-export shared types so downstream code can keep importing them from
// '@core/middleware/review'. No intermediate aliasing required.
export type {
  ReviewActionDescriptor,
  ReviewRequest,
  ReviewUIActionOption,
  ReviewResumePayload,
  ReviewToolMessagePayload,
} from '@shared/agent-types';
export type {ReviewInterruptConfig, ReviewInterruptOn, ReviewDecision} from './review-defaults';
export {
  parseReviewResumeActionPayload,
  applyReviewResumeToolEdits,
  parseReviewToolMessagePayload,
} from './review-payload';

// ── Middleware option types ─────────────────────────────────────────────────

interface ReviewDecisionContext {
  context: ToolCallContext;
  effectiveConfig: ReturnType<typeof resolveEffectiveConfig>;
  interruptConfig: ReviewInterruptConfig | null;
}

type ReviewDecisionResolver = (input: ReviewDecisionContext) => Promise<ReviewDecision | undefined> | ReviewDecision | undefined;
type ReviewRequestFactory = (context: ToolCallContext, config: ReviewInterruptConfig, descriptionPrefix: string) => Promise<ReviewRequest> | ReviewRequest;
type ReviewNotifier = (request: ReviewRequest, context: ToolCallContext) => Promise<void> | void;
type ReviewResumeResolver = (request: ReviewRequest, context: ToolCallContext) => Promise<ReviewResumePayload | undefined> | ReviewResumePayload | undefined;
export type ReviewResumeHandler = (request: ReviewRequest, resumePayload: ReviewResumePayload, context: ToolCallContext, handler: (request?: ToolCallContext) => Promise<ToolMessage>) => Promise<ToolMessage>;
type ReviewMessageFactory = (request: ReviewRequest, context: ToolCallContext) => ToolMessage;
type ReviewDenyMessageFactory = (decision: ReviewDenyDecision, context: ToolCallContext) => ToolMessage;

export interface ReviewMiddlewareOptions {
  enabled?: boolean;
  name?: string;
  interruptOn?: ReviewInterruptOn;
  descriptionPrefix?: string;
  resolveDecision?: ReviewDecisionResolver;
  buildReviewRequest?: ReviewRequestFactory;
  onPause?: ReviewNotifier;
  resolveResume?: ReviewResumeResolver;
  handleResume?: ReviewResumeHandler;
  createReviewMessage?: ReviewMessageFactory;
  createDenyMessage?: ReviewDenyMessageFactory;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_NAME = 'ReviewMiddleware';

function defaultDecisionResolver(input: ReviewDecisionContext): ReviewDecision {
  return input.interruptConfig ? {decision: 'ask', config: input.interruptConfig} : {decision: 'allow'};
}

function defaultResumeResolver(request: ReviewRequest, context: ToolCallContext): ReviewResumePayload | undefined {
  const review = readReviewContext(context.runtime.context);
  const resumes = readRecord(review.resumes);
  if (Object.prototype.hasOwnProperty.call(resumes, request.id)) return resumes[request.id];
  if (Object.prototype.hasOwnProperty.call(resumes, request.action.toolCallId)) return resumes[request.action.toolCallId];
  if (Object.prototype.hasOwnProperty.call(review, 'resume')) return review.resume;
  return undefined;
}

function createDefaultResumeHandler(createDenyMsg: ReviewDenyMessageFactory): ReviewResumeHandler {
  return async (_request, resumePayload, context, handler) => {
    const payload = parseReviewResumeActionPayload(resumePayload);
    if (payload.decision === 'reject') {
      return createDenyMsg({decision: 'deny', reason: payload.comment, ...(payload.metadata ? {metadata: payload.metadata} : {})}, context);
    }
    return handler(applyReviewResumeToolEdits(context, payload));
  };
}

// ── Middleware factory ──────────────────────────────────────────────────────

export function createReviewMiddleware(options: ReviewMiddlewareOptions = {}) {
  const name = options.name?.trim() || DEFAULT_NAME;
  const enabled = options.enabled ?? true;

  const resolveDecision = options.resolveDecision ?? defaultDecisionResolver;
  const buildReviewRequest = options.buildReviewRequest ?? defaultReviewRequestFactory;
  const onPause = options.onPause ?? (() => {});
  const resolveResume = options.resolveResume ?? defaultResumeResolver;
  const createReviewMessage = options.createReviewMessage ?? defaultReviewMessageFactory;
  const createDenyMessage = options.createDenyMessage ?? defaultDenyMessageFactory;
  const handleResume = options.handleResume ?? createDefaultResumeHandler(createDenyMessage);

  return createMiddleware({
    name,
    async wrapToolCall(context, handler) {
      if (!enabled) return handler(context);

      const effectiveConfig = resolveEffectiveConfig(options, context.runtime.context);
      const interruptConfig = resolveInterruptConfig(context.toolCall.name, effectiveConfig.interruptOn);

      const rawDecision = await resolveDecision({context, effectiveConfig, interruptConfig});
      const decision = normalizeDecision(rawDecision, interruptConfig);

      if (decision.decision === 'allow') return handler(context);
      if (decision.decision === 'deny') return decision.message ?? createDenyMessage(decision, context);

      const askConfig = resolveAskConfig(decision, interruptConfig);
      const request = await buildReviewRequest(context, askConfig, effectiveConfig.descriptionPrefix);
      const resumePayload = await resolveResume(request, context);

      if (resumePayload !== undefined) return handleResume(request, resumePayload, context, handler);

      await onPause(request, context);
      return createReviewMessage(request, context);
    },
  });
}

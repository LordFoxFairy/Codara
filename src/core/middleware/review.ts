/**
 * Review middleware — pause/resume interception for tool calls.
 *
 * Consolidates decision evaluation, payload creation, and middleware orchestration
 * into one module. Concrete interaction protocols (approval UI, permission prompts,
 * AskUser forms) are implemented outside via hook options.
 */

import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, readExecutionMetadata, type ToolCallContext} from '@core/pipeline-types';
import {resolveToolCallId} from '@shared/tool-call-id';
import type {
  ReviewActionDescriptor as SharedReviewActionDescriptor,
  ReviewRequest as SharedReviewRequest,
  ReviewDecision as ReviewDecisionValue,
  ReviewUIActionOption as SharedReviewUIActionOption,
  ReviewUIConfig,
  ReviewResumePayload as SharedReviewResumePayload,
} from '@shared/agent-types';

// ---------------------------------------------------------------------------
// Re-exported shared types
// ---------------------------------------------------------------------------

export type ReviewActionDescriptor = SharedReviewActionDescriptor;
export type ReviewRequest = SharedReviewRequest;
export type ReviewUIActionOption = SharedReviewUIActionOption;
export type ReviewResumePayload = SharedReviewResumePayload;
export type {ReviewToolMessagePayload} from '@shared/agent-types';
type ReviewToolMessagePayload = import('@shared/agent-types').ReviewToolMessagePayload;

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

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

export interface ReviewResumeActionPayload {
  decision?: ReviewDecisionValue;
  action?: string;
  scope?: string;
  comment?: string;
  editedToolName?: string;
  editedToolArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

export interface ReviewAllowDecision { decision: 'allow' }
export interface ReviewAskDecision { decision: 'ask'; config?: ReviewInterruptConfig; metadata?: Record<string, unknown> }
export interface ReviewDenyDecision { decision: 'deny'; reason?: string; metadata?: Record<string, unknown>; message?: ToolMessage }
export type ReviewDecision = ReviewAllowDecision | ReviewAskDecision | ReviewDenyDecision;

export interface ReviewDecisionContext {
  context: ToolCallContext;
  effectiveConfig: ReviewEffectiveConfig;
  interruptConfig: ReviewInterruptConfig | null;
}

// ---------------------------------------------------------------------------
// Middleware option types
// ---------------------------------------------------------------------------

export type ReviewDecisionResolver = (input: ReviewDecisionContext) => Promise<ReviewDecision | undefined> | ReviewDecision | undefined;
export type ReviewRequestFactory = (context: ToolCallContext, config: ReviewInterruptConfig, descriptionPrefix: string) => Promise<ReviewRequest> | ReviewRequest;
export type ReviewNotifier = (request: ReviewRequest, context: ToolCallContext) => Promise<void> | void;
export type ReviewResumeResolver = (request: ReviewRequest, context: ToolCallContext) => Promise<ReviewResumePayload | undefined> | ReviewResumePayload | undefined;
export type ReviewResumeHandler = (request: ReviewRequest, resumePayload: ReviewResumePayload, context: ToolCallContext, handler: (request?: ToolCallContext) => Promise<ToolMessage>) => Promise<ToolMessage>;
export type ReviewMessageFactory = (request: ReviewRequest, context: ToolCallContext) => ToolMessage;
export type ReviewDenyMessageFactory = (decision: ReviewDenyDecision, context: ToolCallContext) => ToolMessage;

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

type ReviewContextConfig = Pick<ReviewMiddlewareOptions, 'interruptOn' | 'descriptionPrefix'>;
export interface ReviewEffectiveConfig { interruptOn?: ReviewInterruptOn; descriptionPrefix: string }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_NAME = 'ReviewMiddleware';
const DEFAULT_DESCRIPTION_PREFIX = 'Tool execution requires user review';
const DEFAULT_ALLOWED_DECISIONS: ReviewDecisionValue[] = ['approve', 'edit', 'reject'];

// ---------------------------------------------------------------------------
// Record / string helpers (module-private)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readReviewContext(runtimeContext: unknown): Record<string, unknown> {
  const root = readRecord(runtimeContext);
  const nested = readRecord(root.review);
  return Object.keys(nested).length > 0 ? nested : root;
}

// ---------------------------------------------------------------------------
// Decision evaluation
// ---------------------------------------------------------------------------

function defaultDecisionResolver(input: ReviewDecisionContext): ReviewDecision {
  return input.interruptConfig ? {decision: 'ask', config: input.interruptConfig} : {decision: 'allow'};
}

function normalizeAllowedDecisions(allowedDecisions: ReviewDecisionValue[] | undefined): ReviewDecisionValue[] {
  if (!allowedDecisions || allowedDecisions.length === 0) return [...DEFAULT_ALLOWED_DECISIONS];
  return [...new Set(allowedDecisions)];
}

function normalizeResumeDecision(value: unknown): ReviewDecisionValue | undefined {
  if (value === 'allow') return 'approve';
  if (value === 'deny') return 'reject';
  return isReviewDecisionValue(value) ? value : undefined;
}

function isReviewDecisionValue(value: unknown): value is ReviewDecisionValue {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

function resolveEffectiveConfig(options: ReviewContextConfig & {descriptionPrefix?: string}, runtimeContext: unknown): ReviewEffectiveConfig {
  const review = readReviewContext(runtimeContext);
  return {
    interruptOn: isRecord(review.interruptOn) ? review.interruptOn as ReviewInterruptOn : options.interruptOn,
    descriptionPrefix: readOptionalString(review.descriptionPrefix) ?? options.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
  };
}

function resolveInterruptConfig(toolName: string, interruptOn: ReviewInterruptOn | undefined): ReviewInterruptConfig | null {
  if (!interruptOn) return null;
  const rawValue: unknown = interruptOn[toolName] ?? findPatternConfig(toolName, interruptOn);
  if (rawValue === undefined || rawValue === false) return null;
  if (rawValue === true) return {};
  if (!isInterruptConfig(rawValue)) throw new Error(`Invalid interruptOn config for tool "${toolName}"`);
  return {
    ...(rawValue.description !== undefined ? {description: rawValue.description} : {}),
    ...(rawValue.channel !== undefined ? {channel: rawValue.channel} : {}),
    ...(rawValue.ui !== undefined ? {ui: rawValue.ui} : {}),
    ...(rawValue.metadata !== undefined ? {metadata: rawValue.metadata} : {}),
    ...(rawValue.allowedDecisions !== undefined ? {allowedDecisions: [...rawValue.allowedDecisions]} : {}),
  };
}

function normalizeDecision(decision: ReviewDecision | undefined, interruptConfig: ReviewInterruptConfig | null): ReviewDecision {
  if (!decision) return interruptConfig ? {decision: 'ask', config: interruptConfig} : {decision: 'allow'};
  if (decision.decision === 'allow' || decision.decision === 'deny') return decision;
  if (decision.decision === 'ask') return {...decision, config: resolveAskConfig(decision, interruptConfig)};
  throw new Error(`Unsupported Review decision: ${String((decision as {decision?: unknown}).decision)}`);
}

function resolveAskConfig(decision: ReviewAskDecision, baseConfig: ReviewInterruptConfig | null): ReviewInterruptConfig {
  const base = baseConfig ?? {};
  const next = decision.config ?? {};
  const mergedMetadata = {...(base.metadata ?? {}), ...(next.metadata ?? {}), ...(decision.metadata ?? {})};
  return {
    ...base,
    ...next,
    allowedDecisions: next.allowedDecisions ?? base.allowedDecisions ?? DEFAULT_ALLOWED_DECISIONS,
    ...(Object.keys(mergedMetadata).length > 0 ? {metadata: mergedMetadata} : {}),
  };
}

function findPatternConfig(toolName: string, interruptOn: ReviewInterruptOn): boolean | ReviewInterruptConfig | undefined {
  for (const [pattern, config] of Object.entries(interruptOn)) {
    if (pattern !== toolName && matchesPattern(toolName, pattern)) return config;
  }
  return undefined;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return value.toLowerCase() === pattern.toLowerCase();
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function isInterruptConfig(value: unknown): value is ReviewInterruptConfig {
  if (!isRecord(value)) return false;
  if (value.description !== undefined && typeof value.description !== 'string' && typeof value.description !== 'function') return false;
  if (value.channel !== undefined && typeof value.channel !== 'string') return false;
  if (value.ui !== undefined && !isRecord(value.ui)) return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  if (value.allowedDecisions !== undefined) {
    if (!Array.isArray(value.allowedDecisions)) return false;
    if (value.allowedDecisions.some((d) => !isReviewDecisionValue(d))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Payload creation / parsing
// ---------------------------------------------------------------------------

export function parseReviewResumeActionPayload(payload: ReviewResumePayload): ReviewResumeActionPayload {
  const root = readRecord(payload);
  const normalizedDecision = normalizeResumeDecision(root.decision);
  const editedToolArgs = isRecord(root.editedToolArgs) ? root.editedToolArgs : isRecord(root.updatedInput) ? root.updatedInput : undefined;
  const normalizedComment = readOptionalString(root.comment) ?? readOptionalString(root.reason);
  return {
    ...(normalizedDecision ? {decision: normalizedDecision} : {}),
    ...(readOptionalString(root.action) ? {action: readOptionalString(root.action)} : {}),
    ...(readOptionalString(root.scope) ? {scope: readOptionalString(root.scope)} : {}),
    ...(normalizedComment ? {comment: normalizedComment} : {}),
    ...(readOptionalString(root.editedToolName) ? {editedToolName: readOptionalString(root.editedToolName)} : {}),
    ...(editedToolArgs ? {editedToolArgs} : {}),
    ...(isRecord(root.metadata) ? {metadata: root.metadata} : {}),
  };
}

export function applyReviewResumeToolEdits(context: ToolCallContext, payload: ReviewResumeActionPayload): ToolCallContext {
  if (!payload.editedToolName && !payload.editedToolArgs) return context;
  return {
    ...context,
    toolCall: {
      ...context.toolCall,
      ...(payload.editedToolName ? {name: payload.editedToolName} : {}),
      args: payload.editedToolArgs ? {...readRecord(context.toolCall.args), ...payload.editedToolArgs} : context.toolCall.args,
    },
  };
}

export function parseReviewToolMessagePayload(content: unknown): ReviewToolMessagePayload | undefined {
  const raw = typeof content === 'string' ? content : String(content ?? '');
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
    if (parsed.type === 'review_pause') return isReviewRequest(parsed.request) ? {type: 'review_pause', request: parsed.request} : undefined;
    if (parsed.type === 'review_deny') {
      const action = readRecord(parsed.action);
      if (typeof parsed.reason !== 'string' || !isRecord(parsed.metadata) || typeof action.toolCallId !== 'string' || typeof action.toolName !== 'string') return undefined;
      return {type: 'review_deny', reason: parsed.reason, metadata: parsed.metadata, action: {toolCallId: action.toolCallId, toolName: action.toolName}};
    }
    return undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Default factories (internal — used as fallbacks in createReviewMiddleware)
// ---------------------------------------------------------------------------

async function defaultReviewRequestFactory(context: ToolCallContext, config: ReviewInterruptConfig, descriptionPrefix: string): Promise<ReviewRequest> {
  const execution = readExecutionMetadata(context);
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const toolName = context.toolCall.name;
  const toolArgs = readRecord(context.toolCall.args);
  const description = await resolveDescription(context, config.description, descriptionPrefix, toolName, toolArgs);
  return {
    id: `${execution.runId}:${execution.turn}:${toolCallId}`,
    description,
    action: {toolCallId, toolName, toolArgs},
    review: {actionName: toolName, allowedDecisions: normalizeAllowedDecisions(config.allowedDecisions)},
    runtime: {runId: execution.runId, turn: execution.turn, requestId: execution.requestId, toolIndex: context.toolIndex},
    ...(config.channel ? {channel: config.channel} : {}),
    ...(config.ui ? {ui: config.ui} : {}),
    ...(config.metadata ? {metadata: config.metadata} : {}),
  };
}

function defaultReviewMessageFactory(request: ReviewRequest): ToolMessage {
  const payload: ReviewToolMessagePayload = {type: 'review_pause', request};
  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('review_pause', request.metadata, request.channel, request.ui),
    tool_call_id: request.action.toolCallId,
    name: request.action.toolName,
  });
}

function defaultDenyMessageFactory(decision: ReviewDenyDecision, context: ToolCallContext): ToolMessage {
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const payload: ReviewToolMessagePayload = {
    type: 'review_deny',
    reason: decision.reason?.trim() || 'Tool execution denied by external policy',
    metadata: decision.metadata ?? {},
    action: {toolCallId, toolName: context.toolCall.name},
  };
  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('review_deny', decision.metadata),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
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

async function resolveDescription(context: ToolCallContext, descriptionValue: string | ReviewDescriptionFactory | undefined, descriptionPrefix: string, toolName: string, toolArgs: Record<string, unknown>): Promise<string> {
  if (typeof descriptionValue === 'function') return descriptionValue(context.toolCall, context.state, context.runtime);
  if (typeof descriptionValue === 'string') return descriptionValue;
  return `${descriptionPrefix}\n\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs, null, 2)}`;
}

function buildObservabilityMetadata(toolResultType: 'review_pause' | 'review_deny', metadata?: Record<string, unknown>, channel?: string, ui?: ReviewUIConfig): Record<string, unknown> {
  const skill = typeof metadata?.skill === 'string' ? metadata.skill : undefined;
  const codara = metadata?.codara;
  const actorType = codara && typeof codara === 'object' && !Array.isArray(codara)
    ? (() => { const actor = (codara as Record<string, unknown>).actor; return actor && typeof actor === 'object' && !Array.isArray(actor) && typeof (actor as Record<string, unknown>).agentType === 'string' ? String((actor as Record<string, unknown>).agentType) : undefined; })()
    : undefined;
  const actionIds = Array.isArray(ui?.actions)
    ? ui.actions.map((a) => a.id).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  return {
    toolResultType,
    interactionDecision: toolResultType === 'review_pause' ? 'ask' : 'deny',
    ...(channel ? {interactionChannel: channel} : {}),
    ...(skill ? {interactionSkill: skill} : {}),
    ...(actorType ? {interactionActorType: actorType} : {}),
    ...(actionIds.length > 0 ? {interactionActionIds: actionIds} : {}),
  };
}

function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!isRecord(value)) return false;
  const {id, description, action, review, runtime} = value;
  return typeof id === 'string' && typeof description === 'string'
    && isRecord(action) && typeof (action as Record<string, unknown>).toolCallId === 'string' && typeof (action as Record<string, unknown>).toolName === 'string'
    && isRecord(review) && typeof (review as Record<string, unknown>).actionName === 'string'
    && isRecord(runtime) && typeof (runtime as Record<string, unknown>).runId === 'string';
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Generic review middleware.
 *
 * Only responsible for pause/resume interception. Concrete interaction protocols
 * (approval/edit/reject, permission prompts, AskUser forms) are implemented
 * outside via resolveDecision / resolveResume / handleResume hooks.
 */
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

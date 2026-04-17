/**
 * Default factories + configuration helpers for the review middleware.
 *
 * Covers interrupt-config resolution, ask/allow/deny decision normalization,
 * and the default `buildReviewRequest` / `createReviewMessage` / `createDenyMessage`
 * factories. Split from `review.ts` so the middleware file stays focused on
 * orchestration.
 *
 * @module
 */

import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {readExecutionMetadata, type ToolCallContext} from '@core/pipeline-types';
import {resolveToolCallId} from '@shared/tool-call-id';
import type {
  ReviewDecision as ReviewDecisionValue,
  ReviewRequest,
  ReviewToolMessagePayload,
  ReviewUIConfig,
} from '@shared/agent-types';
import {
  isRecord,
  isReviewDecisionValue,
  readOptionalString,
  readRecord,
  readReviewContext,
} from './review-payload';

type ReviewDescriptionFactory = (
  toolCall: ToolCall,
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

export interface ReviewAllowDecision { decision: 'allow' }
export interface ReviewAskDecision { decision: 'ask'; config?: ReviewInterruptConfig; metadata?: Record<string, unknown> }
export interface ReviewDenyDecision { decision: 'deny'; reason?: string; metadata?: Record<string, unknown>; message?: ToolMessage }
export type ReviewDecision = ReviewAllowDecision | ReviewAskDecision | ReviewDenyDecision;

export interface ReviewEffectiveConfig { interruptOn?: ReviewInterruptOn; descriptionPrefix: string }

export const DEFAULT_DESCRIPTION_PREFIX = 'Tool execution requires user review';
const DEFAULT_ALLOWED_DECISIONS: ReviewDecisionValue[] = ['approve', 'edit', 'reject'];

export function normalizeAllowedDecisions(allowedDecisions: ReviewDecisionValue[] | undefined): ReviewDecisionValue[] {
  if (!allowedDecisions || allowedDecisions.length === 0) return [...DEFAULT_ALLOWED_DECISIONS];
  return [...new Set(allowedDecisions)];
}

export function resolveEffectiveConfig(
  options: {interruptOn?: ReviewInterruptOn; descriptionPrefix?: string},
  runtimeContext: unknown,
): ReviewEffectiveConfig {
  const review = readReviewContext(runtimeContext);
  return {
    interruptOn: isRecord(review.interruptOn) ? review.interruptOn as ReviewInterruptOn : options.interruptOn,
    descriptionPrefix: readOptionalString(review.descriptionPrefix) ?? options.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
  };
}

export function resolveInterruptConfig(toolName: string, interruptOn: ReviewInterruptOn | undefined): ReviewInterruptConfig | null {
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

export function normalizeDecision(decision: ReviewDecision | undefined, interruptConfig: ReviewInterruptConfig | null): ReviewDecision {
  if (!decision) return interruptConfig ? {decision: 'ask', config: interruptConfig} : {decision: 'allow'};
  if (decision.decision === 'allow' || decision.decision === 'deny') return decision;
  if (decision.decision === 'ask') return {...decision, config: resolveAskConfig(decision, interruptConfig)};
  throw new Error(`Unsupported Review decision: ${String((decision as {decision?: unknown}).decision)}`);
}

export function resolveAskConfig(decision: ReviewAskDecision, baseConfig: ReviewInterruptConfig | null): ReviewInterruptConfig {
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

export async function defaultReviewRequestFactory(
  context: ToolCallContext,
  config: ReviewInterruptConfig,
  descriptionPrefix: string,
): Promise<ReviewRequest> {
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

export function defaultReviewMessageFactory(request: ReviewRequest): ToolMessage {
  const payload: ReviewToolMessagePayload = {type: 'review_pause', request};
  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('review_pause', request.metadata, request.channel, request.ui),
    tool_call_id: request.action.toolCallId,
    name: request.action.toolName,
  });
}

export function defaultDenyMessageFactory(decision: ReviewDenyDecision, context: ToolCallContext): ToolMessage {
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

async function resolveDescription(
  context: ToolCallContext,
  descriptionValue: string | ReviewDescriptionFactory | undefined,
  descriptionPrefix: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<string> {
  if (typeof descriptionValue === 'function') return descriptionValue(context.toolCall, context.state, context.runtime);
  if (typeof descriptionValue === 'string') return descriptionValue;
  return `${descriptionPrefix}\n\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs, null, 2)}`;
}

function buildObservabilityMetadata(
  toolResultType: 'review_pause' | 'review_deny',
  metadata?: Record<string, unknown>,
  channel?: string,
  ui?: ReviewUIConfig,
): Record<string, unknown> {
  const skill = typeof metadata?.skill === 'string' ? metadata.skill : undefined;
  const codara = metadata?.codara;
  const actorType = codara && typeof codara === 'object' && !Array.isArray(codara)
    ? (() => {
        const actor = (codara as Record<string, unknown>).actor;
        return actor && typeof actor === 'object' && !Array.isArray(actor) && typeof (actor as Record<string, unknown>).agentType === 'string'
          ? String((actor as Record<string, unknown>).agentType)
          : undefined;
      })()
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

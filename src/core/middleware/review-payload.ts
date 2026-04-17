/**
 * Review payload helpers — parsing resume payloads and the tool-message
 * envelope (`review_pause` / `review_deny`), plus edit application. Split from
 * `review.ts` so the middleware file itself stays focused on orchestration.
 *
 * @module
 */

import type {ToolCallContext} from '@core/pipeline-types';
import type {
  ReviewDecision as ReviewDecisionValue,
  ReviewRequest,
  ReviewResumePayload,
  ReviewToolMessagePayload,
} from '@shared/agent-types';

export interface ReviewResumeActionPayload {
  decision?: ReviewDecisionValue;
  action?: string;
  scope?: string;
  comment?: string;
  editedToolName?: string;
  editedToolArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function readReviewContext(runtimeContext: unknown): Record<string, unknown> {
  const root = readRecord(runtimeContext);
  const nested = readRecord(root.review);
  return Object.keys(nested).length > 0 ? nested : root;
}

export function isReviewDecisionValue(value: unknown): value is ReviewDecisionValue {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

export function normalizeResumeDecision(value: unknown): ReviewDecisionValue | undefined {
  if (value === 'allow') return 'approve';
  if (value === 'deny') return 'reject';
  return isReviewDecisionValue(value) ? value : undefined;
}

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

export function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!isRecord(value)) return false;
  const {id, description, action, review, runtime} = value;
  return typeof id === 'string' && typeof description === 'string'
    && isRecord(action) && typeof (action as Record<string, unknown>).toolCallId === 'string' && typeof (action as Record<string, unknown>).toolName === 'string'
    && isRecord(review) && typeof (review as Record<string, unknown>).actionName === 'string'
    && isRecord(runtime) && typeof (runtime as Record<string, unknown>).runId === 'string';
}

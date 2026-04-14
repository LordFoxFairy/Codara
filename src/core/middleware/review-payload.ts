/**
 * Payload creation, parsing, and manipulation for the review middleware.
 * Handles review requests, resume payloads, tool messages, and observability metadata.
 */

import {ToolMessage, type ToolCall} from '@langchain/core/messages';
import {readExecutionMetadata, type ToolCallContext} from '@core/pipeline/types';
import type {
  ReviewDecision as ReviewDecisionValue,
  ReviewRequest as SharedReviewRequest,
  ReviewUIConfig,
  ReviewResumePayload as SharedReviewResumePayload,
} from '@shared/contracts/agent-types';
import type {
  ReviewDenyDecision,
  ReviewDenyMessageFactory,
  ReviewDescriptionFactory,
  ReviewInterruptConfig,
  ReviewResumeActionPayload,
  ReviewResumeHandler,
  ReviewToolMessagePayload,
} from './review';
import {normalizeAllowedDecisions, normalizeResumeDecision} from './review-evaluator';
import {isRecord, readOptionalString, readRecord, readReviewContext} from './review-utils';

type ReviewRequest = SharedReviewRequest;
type ReviewResumePayload = SharedReviewResumePayload;

export async function defaultReviewRequestFactory(
  context: ToolCallContext,
  config: ReviewInterruptConfig,
  descriptionPrefix: string
): Promise<ReviewRequest> {
  const execution = readExecutionMetadata(context);
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const toolName = context.toolCall.name;
  const toolArgs = normalizeArgs(context.toolCall.args);

  const description = await resolveDescription(context, config.description, descriptionPrefix, toolName, toolArgs);

  return {
    id: `${execution.runId}:${execution.turn}:${toolCallId}`,
    description,
    action: {
      toolCallId,
      toolName,
      toolArgs,
    },
    review: {
      actionName: toolName,
      allowedDecisions: normalizeAllowedDecisions(config.allowedDecisions),
    },
    runtime: {
      runId: execution.runId,
      turn: execution.turn,
      requestId: execution.requestId,
      toolIndex: context.toolIndex,
    },
    ...(config.channel ? {channel: config.channel} : {}),
    ...(config.ui ? {ui: config.ui} : {}),
    ...(config.metadata ? {metadata: config.metadata} : {}),
  };
}

export function noopReviewNotifier(): void {
  return;
}

export function createDefaultResumeHandler(createDenyMessage: ReviewDenyMessageFactory): ReviewResumeHandler {
  return async (_request, resumePayload, context, handler) => {
    const payload = parseReviewResumeActionPayload(resumePayload);
    if (payload.decision === 'reject') {
      return createDenyMessage(
        {
          decision: 'deny',
          reason: payload.comment,
          ...(payload.metadata ? {metadata: payload.metadata} : {}),
        },
        context
      );
    }

    const nextContext = applyReviewResumeToolEdits(context, payload);
    return handler(nextContext);
  };
}

export function defaultReviewMessageFactory(request: ReviewRequest): ToolMessage {
  const payload: ReviewToolMessagePayload = {
    type: 'review_pause',
    request,
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('review_pause', request.metadata, request.channel, request.ui),
    tool_call_id: request.action.toolCallId,
    name: request.action.toolName,
  });
}

export function defaultDenyMessageFactory(decision: ReviewDenyDecision, context: ToolCallContext): ToolMessage {
  const toolCallId = resolveToolCallId(context.toolCall, context.toolIndex);
  const reason = decision.reason?.trim() || 'Tool execution denied by external policy';
  const payload: ReviewToolMessagePayload = {
    type: 'review_deny',
    reason,
    metadata: decision.metadata ?? {},
    action: {
      toolCallId,
      toolName: context.toolCall.name,
    },
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    response_metadata: buildObservabilityMetadata('review_deny', decision.metadata),
    tool_call_id: toolCallId,
    name: context.toolCall.name,
    status: 'error',
  });
}

export function defaultResumeResolver(request: ReviewRequest, context: ToolCallContext): ReviewResumePayload | undefined {
  const review = readReviewContext(context.runtime.context);
  const resumes = readRecord(review.resumes);

  // 1) exact map by pause id
  if (Object.prototype.hasOwnProperty.call(resumes, request.id)) {
    return resumes[request.id];
  }

  // 2) map by tool call id
  if (Object.prototype.hasOwnProperty.call(resumes, request.action.toolCallId)) {
    return resumes[request.action.toolCallId];
  }

  // 3) single resume payload
  if (Object.prototype.hasOwnProperty.call(review, 'resume')) {
    return review.resume;
  }

  return undefined;
}

/**
 * Normalize the external resume payload into a predictable action shape.
 * This keeps UI-specific transport formats out of middleware handlers.
 */
export function parseReviewResumeActionPayload(payload: ReviewResumePayload): ReviewResumeActionPayload {
  const root = readRecord(payload);
  const normalizedDecision = normalizeResumeDecision(root.decision);
  const editedToolArgs = isRecord(root.editedToolArgs)
    ? root.editedToolArgs
    : isRecord(root.updatedInput)
      ? root.updatedInput
      : undefined;
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

/**
 * Apply resume-driven tool edits in a generic way.
 * Review or approval flows can use this to support "edit and continue"
 * without encoding domain semantics in the Review core.
 */
export function applyReviewResumeToolEdits(
  context: ToolCallContext,
  payload: ReviewResumeActionPayload
): ToolCallContext {
  if (!payload.editedToolName && !payload.editedToolArgs) {
    return context;
  }

  return {
    ...context,
    toolCall: {
      ...context.toolCall,
      ...(payload.editedToolName ? {name: payload.editedToolName} : {}),
      args: payload.editedToolArgs
        ? {
            ...normalizeArgs(context.toolCall.args),
            ...payload.editedToolArgs,
          }
        : context.toolCall.args,
    },
  };
}

/**
 * Parse the structured Review tool payload emitted by the default pause/deny
 * factories. Consumers such as terminals or approval services can reuse this
 * helper instead of duplicating ad-hoc JSON parsing.
 */
export function parseReviewToolMessagePayload(content: unknown): ReviewToolMessagePayload | undefined {
  const raw = typeof content === 'string' ? content : String(content ?? '');
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return undefined;
    }

    if (parsed.type === 'review_pause') {
      return isReviewRequest(parsed.request) ? {type: 'review_pause', request: parsed.request} : undefined;
    }

    if (parsed.type === 'review_deny') {
      const action = readRecord(parsed.action);
      if (
        typeof parsed.reason !== 'string'
        || !isRecord(parsed.metadata)
        || typeof action.toolCallId !== 'string'
        || typeof action.toolName !== 'string'
      ) {
        return undefined;
      }

      return {
        type: 'review_deny',
        reason: parsed.reason,
        metadata: parsed.metadata,
        action: {
          toolCallId: action.toolCallId,
          toolName: action.toolName,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveDescription(
  context: ToolCallContext,
  descriptionValue: string | ReviewDescriptionFactory | undefined,
  descriptionPrefix: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  if (typeof descriptionValue === 'function') {
    return descriptionValue(context.toolCall, context.state, context.runtime);
  }
  if (typeof descriptionValue === 'string') {
    return descriptionValue;
  }
  return `${descriptionPrefix}\n\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs, null, 2)}`;
}

export function resolveToolCallId(toolCall: ToolCall, toolIndex: number): string {
  const existingId = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  if (existingId) {
    return existingId;
  }
  return `review_${toolIndex}`;
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  return readRecord(args);
}

function buildObservabilityMetadata(
  toolResultType: 'review_pause' | 'review_deny',
  metadata?: Record<string, unknown>,
  channel?: string,
  ui?: ReviewUIConfig,
): Record<string, unknown> {
  const skill = extractSkillFromMetadata(metadata);
  const actorType = extractActorType(metadata);
  const actionIds = extractActionIds(ui);
  return {
    toolResultType,
    interactionDecision: toolResultType === 'review_pause' ? 'ask' : 'deny',
    ...(channel ? {interactionChannel: channel} : {}),
    ...(skill ? {interactionSkill: skill} : {}),
    ...(actorType ? {interactionActorType: actorType} : {}),
    ...(actionIds.length > 0 ? {interactionActionIds: actionIds} : {}),
  };
}

function extractSkillFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.skill === 'string' ? metadata.skill : undefined;
}

function extractActorType(metadata: Record<string, unknown> | undefined): string | undefined {
  const codara = metadata?.codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const actor = (codara as Record<string, unknown>).actor;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    return undefined;
  }

  return typeof (actor as Record<string, unknown>).agentType === 'string'
    ? String((actor as Record<string, unknown>).agentType)
    : undefined;
}

function extractActionIds(ui: ReviewUIConfig | undefined): string[] {
  if (!Array.isArray(ui?.actions)) {
    return [];
  }

  return ui.actions
    .map((action) => action.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!isRecord(value)) {
    return false;
  }
  const {id, description, action, review, runtime} = value;
  return (
    typeof id === 'string'
    && typeof description === 'string'
    && isRecord(action)
    && typeof (action as Record<string, unknown>).toolCallId === 'string'
    && typeof (action as Record<string, unknown>).toolName === 'string'
    && isRecord(review)
    && typeof (review as Record<string, unknown>).actionName === 'string'
    && isRecord(runtime)
    && typeof (runtime as Record<string, unknown>).runId === 'string'
  );
}

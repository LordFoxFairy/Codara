import {randomUUID} from 'node:crypto';
import {BaseMessage, HumanMessage, ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {mergeContext} from '../command';
import type {
  AgentInput,
  AgentInvokeConfig,
  AgentRuntimeContext,
  AgentState,
  ReviewRequest,
  ReviewResumePayload,
} from '../agent-types';
import type {MiddlewareRuntimeShared} from '@core/pipeline-types';
import {parseReviewToolMessagePayload} from '@core/middleware/review';
import {deepClone} from '@shared/clone';
import type {AgentRunContext} from './agent-runtime';

const DEFAULT_RECURSION_LIMIT = 25;
const recordSchema = z.record(z.string(), z.unknown());

// ── Input normalization ─────────────────────────────────────────────────────

export function normalizeAgentInput(input: AgentInput): BaseMessage[] {
  if (input === undefined) {
    return [];
  }
  if (isMessagesInput(input)) {
    return [...(input as {messages: BaseMessage[]}).messages];
  }
  if (typeof input === 'string') {
    return input.trim() ? [new HumanMessage(input.trim())] : [];
  }
  return Array.isArray(input) ? [...input] : [input];
}

function isMessagesInput(input: AgentInput): input is {messages: BaseMessage[]} {
  return typeof input === 'object' && input !== null && 'messages' in input && Array.isArray((input as {messages?: unknown}).messages);
}

// ── Review helpers (pure functions) ─────────────────────────────────────────

export function readLatestReview(messages: BaseMessage[]): ReviewRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }
    const payload = parseReviewToolMessagePayload(message.content);
    if (payload?.type === 'review_pause') {
      return deepClone(payload.request);
    }
  }
}

export function findPauseMessageIndex(messages: BaseMessage[], review: ReviewRequest): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }
    const payload = parseReviewToolMessagePayload(message.content);
    if (payload?.type !== 'review_pause') {
      continue;
    }
    if (payload.request.id === review.id) {
      return index;
    }
  }
  return -1;
}

export function injectReviewResumePayload(
  context: AgentRuntimeContext | undefined,
  review: ReviewRequest,
  payload: ReviewResumePayload,
): AgentRuntimeContext {
  const root = recordSchema.catch({}).parse(mergeContext({}, context));
  const currentReviewContext = recordSchema.catch({}).parse(root.review);
  const resumes = recordSchema.catch({}).parse(currentReviewContext.resumes);
  root.review = {
    ...currentReviewContext,
    currentReview: deepClone(review),
    resume: payload,
    resumes: {...resumes, [review.id]: payload, [review.action.toolCallId]: payload},
  };
  return root;
}

// ── RunContext factory ───────────────────────────────────────────────────────

export function createRunContext(
  state: AgentState,
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget' | 'signal'> = {},
  runtimeShared: MiddlewareRuntimeShared = {},
): AgentRunContext {
  const maxTurns = config.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
  if (maxTurns < 1) {
    throw new Error('recursionLimit must be at least 1');
  }
  return {
    state,
    runId: randomUUID(),
    maxTurns,
    runtimeContext: deepClone(config.context ?? {}),
    shared: deepClone(runtimeShared),
    inputBudget: config.inputBudget,
    signal: config.signal,
  };
}

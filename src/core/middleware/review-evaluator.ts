/**
 * Decision evaluation logic for the review middleware.
 * Resolves whether a tool call should be allowed, denied, or paused for review.
 */

import type {
  ReviewDecision as ReviewDecisionValue,
} from '@shared/agent-types';
import type {
  ReviewAskDecision,
  ReviewContextConfig,
  ReviewDecision,
  ReviewDecisionContext,
  ReviewEffectiveConfig,
  ReviewInterruptConfig,
  ReviewInterruptOn,
} from './review';
import {isRecord, readOptionalString, readReviewContext} from './review-utils';

const DEFAULT_DESCRIPTION_PREFIX = 'Tool execution requires user review';
const DEFAULT_ALLOWED_DECISIONS: ReviewDecisionValue[] = ['approve', 'edit', 'reject'];

export {DEFAULT_DESCRIPTION_PREFIX, DEFAULT_ALLOWED_DECISIONS};

export function resolveEffectiveConfig(options: ReviewContextConfig & {descriptionPrefix?: string}, runtimeContext: unknown): ReviewEffectiveConfig {
  const review = readReviewContext(runtimeContext);
  return {
    interruptOn: isInterruptOn(review.interruptOn) ? review.interruptOn : options.interruptOn,
    descriptionPrefix: readOptionalString(review.descriptionPrefix) ?? options.descriptionPrefix ?? DEFAULT_DESCRIPTION_PREFIX,
  };
}

export function resolveInterruptConfig(toolName: string, interruptOn: ReviewInterruptOn | undefined): ReviewInterruptConfig | null {
  if (!interruptOn) {
    return null;
  }

  const direct = interruptOn[toolName];
  const rawValue: unknown = direct ?? findPatternConfig(toolName, interruptOn);
  if (rawValue === undefined || rawValue === false) {
    return null;
  }

  if (rawValue === true) {
    return {};
  }

  if (!isInterruptConfig(rawValue)) {
    throw new Error(`Invalid interruptOn config for tool "${toolName}"`);
  }

  return {
    ...(rawValue.description !== undefined ? {description: rawValue.description} : {}),
    ...(rawValue.channel !== undefined ? {channel: rawValue.channel} : {}),
    ...(rawValue.ui !== undefined ? {ui: rawValue.ui} : {}),
    ...(rawValue.metadata !== undefined ? {metadata: rawValue.metadata} : {}),
    ...(rawValue.allowedDecisions !== undefined ? {allowedDecisions: [...rawValue.allowedDecisions]} : {}),
  };
}

export function normalizeDecision(
  decision: ReviewDecision | undefined,
  interruptConfig: ReviewInterruptConfig | null
): ReviewDecision {
  if (!decision) {
    if (!interruptConfig) {
      return {decision: 'allow'};
    }
    return {decision: 'ask', config: interruptConfig};
  }

  if (decision.decision === 'allow' || decision.decision === 'deny') {
    return decision;
  }

  if (decision.decision === 'ask') {
    return {
      ...decision,
      config: resolveAskConfig(decision, interruptConfig),
    };
  }

  throw new Error(`Unsupported Review decision: ${String((decision as {decision?: unknown}).decision)}`);
}

export function resolveAskConfig(decision: ReviewAskDecision, baseConfig: ReviewInterruptConfig | null): ReviewInterruptConfig {
  const base = baseConfig ?? {};
  const next = decision.config ?? {};
  const mergedMetadata = {
    ...(base.metadata ?? {}),
    ...(next.metadata ?? {}),
    ...(decision.metadata ?? {}),
  };

  return {
    ...base,
    ...next,
    allowedDecisions: next.allowedDecisions ?? base.allowedDecisions ?? DEFAULT_ALLOWED_DECISIONS,
    ...(Object.keys(mergedMetadata).length > 0 ? {metadata: mergedMetadata} : {}),
  };
}

export function defaultDecisionResolver(input: ReviewDecisionContext): ReviewDecision {
  if (!input.interruptConfig) {
    return {decision: 'allow'};
  }

  return {
    decision: 'ask',
    config: input.interruptConfig,
  };
}

export function normalizeAllowedDecisions(allowedDecisions: ReviewDecisionValue[] | undefined): ReviewDecisionValue[] {
  if (!allowedDecisions || allowedDecisions.length === 0) {
    return [...DEFAULT_ALLOWED_DECISIONS];
  }

  const unique: ReviewDecisionValue[] = [];
  const seen = new Set<ReviewDecisionValue>();
  for (const decision of allowedDecisions) {
    if (seen.has(decision)) {
      continue;
    }
    seen.add(decision);
    unique.push(decision);
  }

  return unique;
}

export function normalizeResumeDecision(value: unknown): ReviewDecisionValue | undefined {
  if (value === 'allow') {
    return 'approve';
  }
  if (value === 'deny') {
    return 'reject';
  }
  return isReviewDecisionValue(value) ? value : undefined;
}

export function isReviewDecisionValue(value: unknown): value is ReviewDecisionValue {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

function findPatternConfig(toolName: string, interruptOn: ReviewInterruptOn): boolean | ReviewInterruptConfig | undefined {
  for (const [pattern, config] of Object.entries(interruptOn)) {
    if (pattern === toolName) {
      continue;
    }
    if (matchesPattern(toolName, pattern)) {
      return config;
    }
  }
  return undefined;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) {
    return false;
  }

  if (pattern === '*') {
    return true;
  }

  if (!pattern.includes('*')) {
    return value.toLowerCase() === pattern.toLowerCase();
  }

  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(value);
}

function isInterruptOn(value: unknown): value is ReviewInterruptOn {
  return isRecord(value);
}

function isInterruptConfig(value: unknown): value is ReviewInterruptConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (value.description !== undefined && typeof value.description !== 'string' && typeof value.description !== 'function') {
    return false;
  }
  if (value.channel !== undefined && typeof value.channel !== 'string') {
    return false;
  }
  if (value.ui !== undefined && !isRecord(value.ui)) {
    return false;
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return false;
  }
  if (value.allowedDecisions !== undefined) {
    if (!Array.isArray(value.allowedDecisions)) {
      return false;
    }
    if (value.allowedDecisions.some((decision) => !isReviewDecisionValue(decision))) {
      return false;
    }
  }

  return true;
}

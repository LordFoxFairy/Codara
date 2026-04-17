/**
 * Default model pricing configuration.
 *
 * Directly adapted from Claude Code's utils/modelCost.ts:
 * - Same cost tiers (COST_TIER_3_15, COST_TIER_15_75, COST_TIER_5_25, etc.)
 * - Same per-model mapping via MODEL_COSTS
 * - Same fallback strategy for unknown models
 * - Same USD-per-million-tokens unit
 *
 * @see https://platform.claude.com/docs/en/about-claude/pricing
 */

import type {ModelPricing} from './types';

// ── Cost Tiers ──
// Mirrors Claude Code's named cost tiers from utils/modelCost.ts

/** Standard Sonnet pricing: $3 input / $15 output per Mtok. */
export const COST_TIER_3_15: ModelPricing = {
  inputTokens: 3,
  outputTokens: 15,
  promptCacheWriteTokens: 3.75,
  promptCacheReadTokens: 0.3,
};

/** Opus 4/4.1 pricing: $15 input / $75 output per Mtok. */
export const COST_TIER_15_75: ModelPricing = {
  inputTokens: 15,
  outputTokens: 75,
  promptCacheWriteTokens: 18.75,
  promptCacheReadTokens: 1.5,
};

/** Opus 4.5/4.6 pricing: $5 input / $25 output per Mtok. */
export const COST_TIER_5_25: ModelPricing = {
  inputTokens: 5,
  outputTokens: 25,
  promptCacheWriteTokens: 6.25,
  promptCacheReadTokens: 0.5,
};

/** Haiku 3.5 pricing: $0.80 input / $4 output per Mtok. */
export const COST_HAIKU_35: ModelPricing = {
  inputTokens: 0.8,
  outputTokens: 4,
  promptCacheWriteTokens: 1,
  promptCacheReadTokens: 0.08,
};

/** Haiku 4.5 pricing: $1 input / $5 output per Mtok. */
export const COST_HAIKU_45: ModelPricing = {
  inputTokens: 1,
  outputTokens: 5,
  promptCacheWriteTokens: 1.25,
  promptCacheReadTokens: 0.1,
};

// ── OpenAI Pricing Tiers ──

/** GPT-4o pricing: $2.50 input / $10 output per Mtok. */
export const COST_GPT4O: ModelPricing = {
  inputTokens: 2.5,
  outputTokens: 10,
  promptCacheWriteTokens: 2.5,
  promptCacheReadTokens: 1.25,
};

/** GPT-4o-mini pricing: $0.15 input / $0.60 output per Mtok. */
export const COST_GPT4O_MINI: ModelPricing = {
  inputTokens: 0.15,
  outputTokens: 0.6,
  promptCacheWriteTokens: 0.15,
  promptCacheReadTokens: 0.075,
};

// ── Default Unknown Model Cost ──
// Claude Code falls back to COST_TIER_5_25 for unknown models.

export const DEFAULT_UNKNOWN_MODEL_PRICING: ModelPricing = COST_TIER_5_25;

// ── Model Pricing Map ──
// Mirrors Claude Code's MODEL_COSTS record from utils/modelCost.ts.
// Keys are canonical short names (without provider prefixes).

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic — Claude 3.5 family
  'claude-3-5-haiku': COST_HAIKU_35,
  'claude-3-5-sonnet': COST_TIER_3_15,
  'claude-3.5-sonnet': COST_TIER_3_15,

  // Anthropic — Claude 3.7
  'claude-3-7-sonnet': COST_TIER_3_15,
  'claude-3.7-sonnet': COST_TIER_3_15,

  // Anthropic — Claude 4 family
  'claude-sonnet-4': COST_TIER_3_15,
  'claude-sonnet-4-0': COST_TIER_3_15,
  'claude-sonnet-4-5': COST_TIER_3_15,
  'claude-sonnet-4-6': COST_TIER_3_15,
  'claude-opus-4': COST_TIER_15_75,
  'claude-opus-4-0': COST_TIER_15_75,
  'claude-opus-4-1': COST_TIER_15_75,
  'claude-opus-4-5': COST_TIER_5_25,
  'claude-opus-4-6': COST_TIER_5_25,

  // Anthropic — Haiku 4.5
  'claude-haiku-4-5': COST_HAIKU_45,

  // OpenAI
  'gpt-4o': COST_GPT4O,
  'gpt-4o-mini': COST_GPT4O_MINI,
};

/**
 * Normalize a model identifier to a canonical short name for pricing lookup.
 *
 * Mirrors Claude Code's `getCanonicalName()` logic:
 * - Strips provider prefixes (e.g. "anthropic/claude-sonnet-4" → "claude-sonnet-4")
 * - Strips date suffixes (e.g. "claude-sonnet-4-20250514" → "claude-sonnet-4")
 * - Lowercases
 */
export function normalizeModelName(model: string): string {
  let name = model.trim().toLowerCase();

  // Strip provider prefix (e.g. "anthropic/", "openai/")
  const slashIndex = name.indexOf('/');
  if (slashIndex >= 0) {
    name = name.slice(slashIndex + 1);
  }

  // Strip date suffixes like -20250514 or @20250514 (8-digit dates)
  name = name.replace(/[-@]\d{8}$/, '');

  // Strip ":latest" or ":beta" suffixes
  const colonIndex = name.indexOf(':');
  if (colonIndex >= 0) {
    name = name.slice(0, colonIndex);
  }

  return name;
}

/**
 * Get pricing for a model. Falls back to default unknown pricing.
 *
 * Mirrors Claude Code's `getModelCosts()` from utils/modelCost.ts.
 *
 * @returns `[pricing, isKnown]` tuple — `isKnown` is false when the model
 * is not in the pricing table and fallback pricing was used.
 */
export function getModelPricing(model: string): [ModelPricing, boolean] {
  const canonical = normalizeModelName(model);
  const pricing = MODEL_PRICING[canonical];
  if (pricing) {
    return [pricing, true];
  }
  return [DEFAULT_UNKNOWN_MODEL_PRICING, false];
}

/**
 * Calculate USD cost from token usage and pricing.
 *
 * Mirrors Claude Code's `tokensToUSDCost()` from utils/modelCost.ts:
 * `(tokens / 1_000_000) * ratePerMTok` for each category.
 */
export function calculateUSDCost(
  pricing: ModelPricing,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  },
): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputTokens +
    ((usage.cacheReadInputTokens ?? 0) / 1_000_000) * pricing.promptCacheReadTokens +
    ((usage.cacheCreationInputTokens ?? 0) / 1_000_000) * pricing.promptCacheWriteTokens
  );
}

/**
 * Format model pricing as a display string (e.g. "$3/$15 per Mtok").
 * Mirrors Claude Code's `formatModelPricing()`.
 */
export function formatModelPricing(pricing: ModelPricing): string {
  const fmtIn = formatPrice(pricing.inputTokens);
  const fmtOut = formatPrice(pricing.outputTokens);
  return `${fmtIn}/${fmtOut} per Mtok`;
}

function formatPrice(price: number): string {
  if (Number.isInteger(price)) {
    return `$${price}`;
  }
  return `$${price.toFixed(2)}`;
}

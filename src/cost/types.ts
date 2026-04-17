/**
 * Cost tracking types.
 *
 * Adapted from Claude Code's cost tracking architecture:
 * - cost-tracker.ts (session cost accumulation, per-model breakdown)
 * - utils/modelCost.ts (ModelCosts pricing structure, calculateUSDCost)
 * - bootstrap/state.ts (ModelUsage cumulative shape)
 *
 * Key design decisions preserved from Claude Code:
 * - Pricing is per-million-tokens (USD/MTok) — same unit as Anthropic's pricing page
 * - Per-model usage tracks input/output/cacheRead/cacheWrite independently
 * - Unknown models fall back to a default cost tier with a flag
 * - Snapshot includes both aggregate and per-model breakdown
 */

// ── Pricing ──

/**
 * Per-model pricing rates in USD per million tokens.
 * Direct adaptation of Claude Code's `ModelCosts` from utils/modelCost.ts.
 *
 * Claude Code also tracks `webSearchRequests` — omitted here because
 * Codara's LangChain-based pipeline does not expose web search as a
 * separate billing dimension. Can be added later when needed.
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputTokens: number;
  /** USD per 1M output tokens. */
  outputTokens: number;
  /** USD per 1M prompt cache write (creation) tokens. */
  promptCacheWriteTokens: number;
  /** USD per 1M prompt cache read tokens. */
  promptCacheReadTokens: number;
}

// ── Usage Recording ──

/**
 * Token usage data for a single model call.
 * Passed to `CostTracker.record()`.
 */
export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * A single recorded cost entry, produced internally by CostTracker.
 */
export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  timestamp: string;
}

// ── Per-Model Usage ──

/**
 * Cumulative usage summary for a single model.
 * Mirrors Claude Code's `ModelUsage` from agentSdkTypes / bootstrap/state.
 */
export interface ModelUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

// ── Snapshot ──

/**
 * Session-wide cost snapshot returned by `CostTracker.getSnapshot()`.
 * Mirrors the data exposed by Claude Code's `formatTotalCost()` and
 * `getModelUsage()` from cost-tracker.ts.
 */
export interface CostSnapshot {
  /** Total estimated USD cost for the session. */
  totalCostUSD: number;
  /** Number of API calls recorded. */
  totalCalls: number;
  /** Total input tokens across all calls. */
  totalInputTokens: number;
  /** Total output tokens across all calls. */
  totalOutputTokens: number;
  /** Total cache read tokens across all calls. */
  totalCacheReadInputTokens: number;
  /** Total cache write tokens across all calls. */
  totalCacheCreationInputTokens: number;
  /** Per-model breakdown. Keys are model identifiers. */
  byModel: Record<string, ModelUsageSummary>;
  /** Whether any call used an unknown model (cost may be approximate). */
  hasUnknownModelCost: boolean;
}

// ── Thresholds ──

/**
 * Configurable cost threshold for warning notifications.
 * Claude Code's CostThresholdDialog.tsx shows a warning dialog when thresholds
 * are crossed — Codara adapts this as an event-based notification.
 */
export interface CostThreshold {
  /** USD amount that triggers the threshold. */
  amountUSD: number;
  /** Optional label for display (e.g. "high cost warning"). */
  label?: string;
}

/**
 * Event emitted when a cost threshold is crossed.
 */
export interface CostThresholdCrossedEvent {
  threshold: CostThreshold;
  currentCostUSD: number;
  snapshot: CostSnapshot;
}

/**
 * Session-scoped cost tracker.
 *
 * Adapted from Claude Code's cost tracking architecture:
 * - cost-tracker.ts: `addToTotalSessionCost()`, `formatTotalCost()`, per-model accumulation
 * - bootstrap/state.ts: mutable `STATE.modelUsage`, `STATE.totalCostUSD`, `STATE.hasUnknownModelCost`
 *
 * Key adaptation: Claude Code uses global mutable state; Codara uses a class instance
 * per session, which is more suitable for a library/framework where multiple sessions
 * can coexist.
 *
 * Design decisions preserved from Claude Code:
 * - Per-model usage breakdown (same shape as `ModelUsage` in state.ts)
 * - `hasUnknownModelCost` flag for unknown model pricing
 * - Threshold crossing events (maps to Claude Code's CostThresholdDialog)
 * - Cost formatting with smart decimal handling (same as `formatCost()`)
 */

import type {
  CostEntry,
  CostSnapshot,
  CostThreshold,
  CostThresholdCrossedEvent,
  ModelUsageSummary,
  TokenUsage,
} from './types';
import {calculateUSDCost, getModelPricing} from './pricing';

export type CostEventListener = (event: CostThresholdCrossedEvent) => void;

export interface CostTrackerOptions {
  /** Cost thresholds that trigger events when crossed. */
  thresholds?: CostThreshold[];
  /** Listener for threshold crossing events. */
  onThresholdCrossed?: CostEventListener;
}

/**
 * Session-scoped cost tracker.
 *
 * Usage:
 * ```ts
 * const tracker = new CostTracker({ thresholds: [{ amountUSD: 1 }] });
 * tracker.record({ model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500 });
 * const snapshot = tracker.getSnapshot();
 * ```
 */
export class CostTracker {
  // ── Internal State (mirrors Claude Code's STATE in bootstrap/state.ts) ──
  private totalCostUSD = 0;
  private totalCalls = 0;
  private hasUnknownModel = false;
  private readonly modelUsage: Record<string, ModelUsageSummary> = {};
  private readonly entries: CostEntry[] = [];

  // ── Threshold State ──
  private readonly thresholds: CostThreshold[];
  private readonly crossedThresholds = new Set<number>();
  private readonly onThresholdCrossed?: CostEventListener;

  constructor(options: CostTrackerOptions = {}) {
    this.thresholds = [...(options.thresholds ?? [])].sort((a, b) => a.amountUSD - b.amountUSD);
    this.onThresholdCrossed = options.onThresholdCrossed;
  }

  /**
   * Record a model call's token usage and accumulate cost.
   *
   * Mirrors Claude Code's `addToTotalSessionCost()` from cost-tracker.ts:
   * 1. Look up model pricing (with fallback for unknown models)
   * 2. Calculate USD cost from token counts
   * 3. Accumulate into per-model usage map
   * 4. Check threshold crossings
   *
   * @returns The calculated cost in USD for this single call.
   */
  record(usage: TokenUsage): number {
    const [pricing, isKnown] = getModelPricing(usage.model);
    if (!isKnown) {
      this.hasUnknownModel = true;
    }

    const cacheRead = usage.cacheReadInputTokens ?? 0;
    const cacheWrite = usage.cacheCreationInputTokens ?? 0;

    const costUSD = calculateUSDCost(pricing, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheWrite,
    });

    // Accumulate per-model usage (mirrors addToTotalModelUsage in cost-tracker.ts)
    const model = usage.model;
    const existing = this.modelUsage[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    };
    existing.inputTokens += usage.inputTokens;
    existing.outputTokens += usage.outputTokens;
    existing.cacheReadInputTokens += cacheRead;
    existing.cacheCreationInputTokens += cacheWrite;
    existing.costUSD += costUSD;
    this.modelUsage[model] = existing;

    // Accumulate session totals (mirrors addToTotalCostState in state.ts)
    this.totalCostUSD += costUSD;
    this.totalCalls += 1;

    // Record entry
    this.entries.push({
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheWrite,
      costUSD,
      timestamp: new Date().toISOString(),
    });

    // Check thresholds (mirrors CostThresholdDialog behavior)
    this.checkThresholds();

    return costUSD;
  }

  /**
   * Get a snapshot of the current session cost state.
   *
   * Mirrors the data that Claude Code exposes via `getTotalCostUSD()`,
   * `getModelUsage()`, `getTotalInputTokens()`, etc. from bootstrap/state.ts.
   */
  getSnapshot(): CostSnapshot {
    // Compute aggregate token counts from per-model usage
    // (same approach as Claude Code's sumBy over Object.values(STATE.modelUsage))
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadInputTokens = 0;
    let totalCacheCreationInputTokens = 0;

    const byModel: Record<string, ModelUsageSummary> = {};
    for (const [model, usage] of Object.entries(this.modelUsage)) {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      totalCacheReadInputTokens += usage.cacheReadInputTokens;
      totalCacheCreationInputTokens += usage.cacheCreationInputTokens;
      byModel[model] = {...usage};
    }

    return {
      totalCostUSD: this.totalCostUSD,
      totalCalls: this.totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadInputTokens,
      totalCacheCreationInputTokens,
      byModel,
      hasUnknownModelCost: this.hasUnknownModel,
    };
  }

  /**
   * Reset all tracked state. Used for testing.
   * Mirrors Claude Code's `resetCostState()` / `resetStateForTests()`.
   */
  reset(): void {
    this.totalCostUSD = 0;
    this.totalCalls = 0;
    this.hasUnknownModel = false;
    for (const key of Object.keys(this.modelUsage)) {
      delete this.modelUsage[key];
    }
    this.entries.length = 0;
    this.crossedThresholds.clear();
  }

  private checkThresholds(): void {
    if (!this.onThresholdCrossed) return;

    for (let i = 0; i < this.thresholds.length; i++) {
      const threshold = this.thresholds[i]!;
      if (this.crossedThresholds.has(i)) continue;
      if (this.totalCostUSD >= threshold.amountUSD) {
        this.crossedThresholds.add(i);
        this.onThresholdCrossed({
          threshold,
          currentCostUSD: this.totalCostUSD,
          snapshot: this.getSnapshot(),
        });
      }
    }
  }
}

// ── Formatting ──
// Mirrors Claude Code's formatCost() and formatTotalCost() from cost-tracker.ts.

/**
 * Format a USD cost for display.
 * Mirrors Claude Code's `formatCost()`: shows 2 decimals for costs > $0.50,
 * otherwise shows up to `maxDecimalPlaces` decimals.
 */
export function formatCost(cost: number, maxDecimalPlaces = 4): string {
  if (cost > 0.5) {
    return `$${(Math.round(cost * 100) / 100).toFixed(2)}`;
  }
  return `$${cost.toFixed(maxDecimalPlaces)}`;
}

/**
 * Format a number with human-readable units (k, M).
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format a cost snapshot as a multi-line summary string.
 * Mirrors Claude Code's `formatTotalCost()` layout from cost-tracker.ts.
 */
export function formatCostSnapshot(snapshot: CostSnapshot): string {
  const costDisplay =
    formatCost(snapshot.totalCostUSD) +
    (snapshot.hasUnknownModelCost ? ' (costs may be inaccurate due to usage of unknown models)' : '');

  const lines = [
    `Total cost:   ${costDisplay}`,
    `API calls:    ${snapshot.totalCalls}`,
  ];

  // Per-model breakdown (mirrors formatModelUsage in cost-tracker.ts)
  const models = Object.entries(snapshot.byModel);
  if (models.length > 0) {
    lines.push('Usage by model:');
    for (const [model, usage] of models) {
      lines.push(
        `  ${model}: ${formatNumber(usage.inputTokens)} input, ` +
        `${formatNumber(usage.outputTokens)} output, ` +
        `${formatNumber(usage.cacheReadInputTokens)} cache read, ` +
        `${formatNumber(usage.cacheCreationInputTokens)} cache write ` +
        `(${formatCost(usage.costUSD)})`,
      );
    }
  }

  return lines.join('\n');
}

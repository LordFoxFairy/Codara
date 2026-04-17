/**
 * Cost tracking — session-scoped token usage and USD cost accumulation.
 *
 * Adapted from Claude Code's cost-tracker.ts architecture:
 * - Per-model usage breakdown with pricing lookup
 * - Threshold crossing events for cost warnings
 * - Formatting utilities matching Claude Code's display conventions
 *
 * @module observability/cost
 */
export * from './types';
export {
  CostTracker,
  formatCost,
  formatNumber,
  formatCostSnapshot,
  type CostTrackerOptions,
  type CostEventListener,
} from './tracker';
export {
  MODEL_PRICING,
  DEFAULT_UNKNOWN_MODEL_PRICING,
  normalizeModelName,
  getModelPricing,
  calculateUSDCost,
  formatModelPricing,
} from './pricing';

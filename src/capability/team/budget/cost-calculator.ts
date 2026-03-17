import { MODEL_PRICING } from '@capability/team/types';
import type { TeamBudgetUsage } from '@capability/team/types';

/** Calculate total estimated cost from usage data */
export function calculateCost(usage: TeamBudgetUsage): number {
  let total = 0;
  for (const [, member] of usage.byMember) {
    const pricing = MODEL_PRICING[member.model] ?? MODEL_PRICING['claude-sonnet-4-6'];
    if (pricing) {
      total += (member.inputTokens / 1_000_000) * pricing.inputPer1M;
      total += (member.outputTokens / 1_000_000) * pricing.outputPer1M;
    }
  }
  return total;
}

/** Format token count for display (22800 -> "22.8k") */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format cost for display */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

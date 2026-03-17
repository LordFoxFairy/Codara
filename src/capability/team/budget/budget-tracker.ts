import type { TeamBudgetConfig, MemberTokenUsage, TeamBudgetUsage } from '@capability/team/types';
import { MODEL_PRICING } from '@capability/team/types';

export type BudgetAction = 'none' | 'warning' | 'exceeded';

export interface BudgetCheckResult {
  action: BudgetAction;
  usedPercent: number;
  remaining: number;
}

export class TeamBudgetTracker {
  private usage: TeamBudgetUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byMember: new Map(),
    estimatedCost: 0,
  };

  constructor(private readonly config?: TeamBudgetConfig) {}

  /** Record token usage for a member */
  recordUsage(memberId: string, model: string, input: number, output: number): BudgetCheckResult {
    // Update member usage
    const existing = this.usage.byMember.get(memberId) ?? {
      memberId, model, inputTokens: 0, outputTokens: 0, turns: 0,
    };
    existing.inputTokens += input;
    existing.outputTokens += output;
    existing.model = model;
    existing.turns++;
    this.usage.byMember.set(memberId, existing);

    // Update totals
    this.usage.totalInputTokens += input;
    this.usage.totalOutputTokens += output;
    this.usage.totalTokens += input + output;
    this.usage.estimatedCost = this.calculateCost();

    return this.checkBudget();
  }

  /** Check if budget thresholds are reached */
  checkBudget(): BudgetCheckResult {
    if (!this.config?.teamMaxTokens) {
      return { action: 'none', usedPercent: 0, remaining: Infinity };
    }

    const limit = this.config.teamMaxTokens;
    const ratio = this.usage.totalTokens / limit;
    const remaining = Math.max(0, limit - this.usage.totalTokens);
    const usedPercent = Math.min(100, Math.round(ratio * 100));

    if (ratio >= 1.0) {
      return { action: 'exceeded', usedPercent, remaining: 0 };
    }
    if (ratio >= 0.9) {
      return { action: 'warning', usedPercent, remaining };
    }
    return { action: 'none', usedPercent, remaining };
  }

  /** Check if a specific member has exceeded their budget */
  checkMemberBudget(memberId: string): boolean {
    if (!this.config?.memberMaxTokens) return true; // no limit
    const memberUsage = this.usage.byMember.get(memberId);
    if (!memberUsage) return true; // no usage yet
    const total = memberUsage.inputTokens + memberUsage.outputTokens;
    return total < this.config.memberMaxTokens;
  }

  /** Calculate estimated cost based on model pricing */
  private calculateCost(): number {
    let total = 0;
    for (const [, member] of this.usage.byMember) {
      const pricing = MODEL_PRICING[member.model] ?? MODEL_PRICING['claude-sonnet-4-6'];
      if (pricing) {
        total += (member.inputTokens / 1_000_000) * pricing.inputPer1M;
        total += (member.outputTokens / 1_000_000) * pricing.outputPer1M;
      }
    }
    return total;
  }

  /** Get current usage snapshot */
  getUsage(): TeamBudgetUsage {
    return { ...this.usage, byMember: new Map(this.usage.byMember) };
  }

  /** Get the budget policy action when exceeded */
  getExceededPolicy(): 'pause' | 'warn_leader' | 'shutdown' {
    return this.config?.onBudgetExceeded ?? 'warn_leader';
  }
}

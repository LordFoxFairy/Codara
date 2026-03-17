import { describe, test, expect } from 'bun:test';
import { TeamBudgetTracker } from '@capability/team/budget/budget-tracker';
import { calculateCost, formatTokenCount, formatCost } from '@capability/team/budget/cost-calculator';
import { MODEL_PRICING } from '@capability/team/types';
import type { TeamBudgetUsage, MemberTokenUsage } from '@capability/team/types';

describe('TeamBudgetTracker', () => {
  test('recordUsage accumulates tokens', () => {
    const tracker = new TeamBudgetTracker({ teamMaxTokens: 100_000, onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 1000, 500);
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 2000, 1000);
    const usage = tracker.getUsage();
    expect(usage.totalInputTokens).toBe(3000);
    expect(usage.totalOutputTokens).toBe(1500);
    expect(usage.totalTokens).toBe(4500);
    const member = usage.byMember.get('m1')!;
    expect(member.turns).toBe(2);
  });

  test('checkBudget returns "none" with no limit', () => {
    const tracker = new TeamBudgetTracker();
    const result = tracker.checkBudget();
    expect(result.action).toBe('none');
    expect(result.remaining).toBe(Infinity);
  });

  test('checkBudget returns "warning" at 90%', () => {
    const tracker = new TeamBudgetTracker({ teamMaxTokens: 10_000, onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 5000, 4500); // 9500 / 10000 = 95%
    const result = tracker.checkBudget();
    expect(result.action).toBe('warning');
    expect(result.usedPercent).toBe(95);
  });

  test('checkBudget returns "exceeded" at 100%', () => {
    const tracker = new TeamBudgetTracker({ teamMaxTokens: 10_000, onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 6000, 4000); // exactly 10000
    const result = tracker.checkBudget();
    expect(result.action).toBe('exceeded');
    expect(result.remaining).toBe(0);
  });

  test('checkMemberBudget enforces per-member limit', () => {
    const tracker = new TeamBudgetTracker({ memberMaxTokens: 5000, onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 3000, 2000); // total 5000
    expect(tracker.checkMemberBudget('m1')).toBe(false);
  });

  test('checkMemberBudget returns true with no limit', () => {
    const tracker = new TeamBudgetTracker({ onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 100_000, 100_000);
    expect(tracker.checkMemberBudget('m1')).toBe(true);
  });

  test('calculateCost uses correct model pricing', () => {
    const tracker = new TeamBudgetTracker({ teamMaxTokens: 1_000_000, onBudgetExceeded: 'warn_leader' });
    tracker.recordUsage('m1', 'claude-sonnet-4-6', 1_000_000, 0);
    const usage = tracker.getUsage();
    const pricing = MODEL_PRICING['claude-sonnet-4-6'];
    // 1M input tokens * inputPer1M
    expect(usage.estimatedCost).toBeCloseTo(pricing.inputPer1M, 2);
  });

  test('getExceededPolicy returns correct default', () => {
    const tracker = new TeamBudgetTracker();
    expect(tracker.getExceededPolicy()).toBe('warn_leader');

    const tracker2 = new TeamBudgetTracker({ onBudgetExceeded: 'shutdown' });
    expect(tracker2.getExceededPolicy()).toBe('shutdown');
  });
});

describe('cost-calculator', () => {
  test('formatTokenCount formats correctly', () => {
    expect(formatTokenCount(22800)).toBe('22.8k');
    expect(formatTokenCount(1500000)).toBe('1.5M');
    expect(formatTokenCount(500)).toBe('500');
  });

  test('formatCost formats correctly', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(123.456)).toBe('$123.46');
  });

  test('calculateCost computes from usage data', () => {
    const usage: TeamBudgetUsage = {
      totalInputTokens: 1_000_000,
      totalOutputTokens: 500_000,
      totalTokens: 1_500_000,
      byMember: new Map<string, MemberTokenUsage>([
        ['m1', { memberId: 'm1', model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 500_000, turns: 5 }],
      ]),
      estimatedCost: 0,
    };
    const pricing = MODEL_PRICING['claude-sonnet-4-6'];
    const expected = (1_000_000 / 1_000_000) * pricing.inputPer1M + (500_000 / 1_000_000) * pricing.outputPer1M;
    expect(calculateCost(usage)).toBeCloseTo(expected, 2);
  });
});

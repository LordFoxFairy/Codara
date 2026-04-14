import {describe, expect, it} from 'bun:test';
import {createTokenBudgetState, shouldAutoCompact, shouldStopContinuation, estimateTokenCount, estimateMessagesTokenCount} from '../../../src/core/agent/run/token-budget';

describe('token-budget', () => {
  it('should create initial budget state', () => {
    const budget = createTokenBudgetState(128000);
    expect(budget.contextWindow).toBe(128000);
    expect(budget.reservedOutput).toBe(4096);
    expect(budget.estimatedUsed).toBe(0);
  });

  it('should not auto-compact when usage is low', () => {
    const budget = createTokenBudgetState(128000);
    budget.estimatedUsed = 50000; // ~40%
    expect(shouldAutoCompact(budget)).toBe(false);
  });

  it('should auto-compact at 85% usage', () => {
    const budget = createTokenBudgetState(128000);
    const available = 128000 - 4096;
    budget.estimatedUsed = Math.ceil(available * 0.86);
    expect(shouldAutoCompact(budget)).toBe(true);
  });

  it('should stop continuation at 95% usage', () => {
    const budget = createTokenBudgetState(128000);
    const available = 128000 - 4096;
    budget.estimatedUsed = Math.ceil(available * 0.96);
    expect(shouldStopContinuation(budget)).toBe(true);
  });

  it('should stop on diminishing returns', () => {
    const budget = createTokenBudgetState(128000);
    budget.continuationCount = 4;
    budget.lastDeltaTokens = 300;
    expect(shouldStopContinuation(budget)).toBe(true);
  });

  it('should not stop with good token progress', () => {
    const budget = createTokenBudgetState(128000);
    budget.continuationCount = 4;
    budget.lastDeltaTokens = 1000;
    expect(shouldStopContinuation(budget)).toBe(false);
  });

  it('should estimate token count', () => {
    expect(estimateTokenCount('hello world')).toBe(3); // 11 chars / 4 = 2.75 → ceil = 3
  });

  it('should estimate messages token count', () => {
    const count = estimateMessagesTokenCount([
      {content: 'Hello'},
      {content: 'World'},
    ]);
    expect(count).toBeGreaterThan(0);
  });
});

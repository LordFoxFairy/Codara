import {describe, expect, it} from 'bun:test';
import {HumanMessage} from '@langchain/core/messages';
import {
  createContextBudgetSnapshot,
  estimateModelInputTokens,
  refreshContextBudget,
} from '@core/middleware/budget';
import type {BeforeModelContext} from '@core/middleware';

describe('context budget middleware', () => {
  it('should create a budget snapshot from input budget and model input', () => {
    const snapshot = createContextBudgetSnapshot(
      {
        maxInputTokens: 100,
        reservedTokens: 20,
      },
      {
        systemMessage: ['base system'],
        messages: [new HumanMessage('hello world')],
      },
    );

    expect(snapshot?.maxInputTokens).toBe(100);
    expect(snapshot?.reservedTokens).toBe(20);
    expect(snapshot?.availableInputTokens).toBe(80);
    expect(snapshot?.estimatedInputTokens).toBeGreaterThan(0);
    expect(snapshot?.overBudget).toBe(false);
  });

  it('should refresh the runtime budget snapshot directly on a beforeModel-shaped context', () => {
    const context: BeforeModelContext = {
      state: {
        messages: [new HumanMessage('hello world')],
      },
      messages: [new HumanMessage('hello world')],
      runtime: {context: {}},
      systemMessage: ['x'.repeat(200)],
      execution: {
        sessionId: 'thread-budget',
        runId: 'run-budget',
        turn: 1,
        maxTurns: 5,
        requestId: 'req-budget',
      },
      inputBudget: {maxInputTokens: 20},
    };

    refreshContextBudget(context);

    expect(context.budget?.estimatedInputTokens).toBeGreaterThan(20);
    expect(context.budget?.overBudget).toBe(true);
  });

  it('should reuse the default estimator when refreshing budget directly', () => {
    const context: BeforeModelContext = {
      state: {
        messages: [new HumanMessage('hello world')],
      },
      messages: [new HumanMessage('hello world')],
      runtime: {context: {}},
      systemMessage: ['base system'],
      execution: {
        sessionId: 'thread-refresh',
        runId: 'run-refresh',
        turn: 1,
        maxTurns: 5,
        requestId: 'req-refresh',
      },
      inputBudget: {maxInputTokens: 50},
    };

    const snapshot = refreshContextBudget(context);

    expect(snapshot?.estimatedInputTokens).toBe(
      estimateModelInputTokens({
        systemMessage: context.systemMessage,
        messages: context.state.messages,
      })
    );
    expect(context.budget).toEqual(snapshot);
  });
});

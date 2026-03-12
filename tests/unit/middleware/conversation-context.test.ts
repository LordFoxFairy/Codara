import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import type {ModelCallContext} from '@core/middleware';
import {createBudgetMiddleware} from '@core/middleware';
import {MiddlewarePipeline} from '@core/middleware/pipeline';
import {createSummaryMiddleware} from '@core/middleware/summary';

describe('budget and summary middleware', () => {
  function readSummaryMessage(messages: BaseMessage[]): BaseMessage | undefined {
    return messages.find((message) => message.getType() === 'ai' && message.text.startsWith('Summary:\n'));
  }

  it('should refresh budget and compact history in one stage', async () => {
    const budget = createBudgetMiddleware();
    const summary = createSummaryMiddleware({
      summary: {
        summarize: () => 'summary block',
      },
    });

    const pipeline = new MiddlewarePipeline([budget, summary!]);
    const messages: BaseMessage[] = [
      new HumanMessage('one'),
      new AIMessage('two'),
      new HumanMessage('three'),
      new AIMessage('four'),
      new HumanMessage('five'),
    ];

    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {context: {}},
      systemMessage: ['x'.repeat(120)],
      execution: {
        threadId: 'thread-1',
        runId: 'run-1',
        turn: 1,
        maxTurns: 8,
        requestId: 'req-1',
      },
      inputBudget: {
        maxInputTokens: 20,
      },
    };

    await pipeline.beforeModel(context);

    expect(context.budget).toBeDefined();
    expect(context.budget?.estimatedInputTokens).toBeGreaterThan(0);
    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nsummary block');
  });

  it('should still refresh budget when summary is disabled', async () => {
    const pipeline = new MiddlewarePipeline([createBudgetMiddleware()]);
    const messages: BaseMessage[] = [new HumanMessage('hello')];

    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {context: {}},
      systemMessage: ['caller prompt'],
      execution: {
        threadId: 'thread-2',
        runId: 'run-2',
        turn: 1,
        maxTurns: 8,
        requestId: 'req-2',
      },
      inputBudget: {
        maxInputTokens: 40,
      },
    };

    await pipeline.beforeModel(context);

    expect(context.budget).toBeDefined();
    expect(readSummaryMessage(context.state.messages)).toBeUndefined();
  });

  it('should keep both stages as beforeModel-only middleware', () => {
    const budget = createBudgetMiddleware();
    const summary = createSummaryMiddleware({
      summary: {
        summarize: () => 'summary block',
      },
    });

    for (const middleware of [budget, summary!]) {
      expect(middleware.beforeModel).toEqual(expect.any(Function));
      expect(middleware.beforeAgent).toBeUndefined();
      expect(middleware.wrapModelCall).toBeUndefined();
      expect(middleware.afterModel).toBeUndefined();
      expect(middleware.wrapToolCall).toBeUndefined();
      expect(middleware.afterAgent).toBeUndefined();
    }
  });

  it('should not force summary compaction when messages are below the automatic threshold', async () => {
    const summary = createSummaryMiddleware({
      summary: {
        summarize: () => 'manual summary block',
      },
    });

    const pipeline = new MiddlewarePipeline([createBudgetMiddleware(), summary!]);
    const messages: BaseMessage[] = [
      new HumanMessage('one'),
      new AIMessage('two'),
      new HumanMessage('three'),
      new AIMessage('four'),
      new HumanMessage('five'),
    ];

    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {context: {}},
      systemMessage: ['caller prompt'],
      execution: {
        threadId: 'thread-3',
        runId: 'run-3',
        turn: 1,
        maxTurns: 8,
        requestId: 'req-3',
      },
      inputBudget: {
        maxInputTokens: 400,
      },
    };

    await pipeline.beforeModel(context);

    expect(readSummaryMessage(context.state.messages)).toBeUndefined();
  });
});

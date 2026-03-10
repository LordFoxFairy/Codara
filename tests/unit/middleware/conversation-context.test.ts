import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import {MiddlewarePipeline, type ModelCallContext} from '@core/middleware';
import {createConversationContextMiddleware} from '@core/middleware/conversation-context';
import {readSummaryRecord} from '@core/middleware/summary';

describe('conversation context middleware', () => {
  it('should refresh budget and compact history in one stage', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        summarize: () => 'summary block',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
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
      runId: 'run-1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req-1',
      inputBudget: {
        maxInputTokens: 40,
      },
    };

    await pipeline.beforeModel(context);

    expect(context.budget).toBeDefined();
    expect(context.budget?.estimatedInputTokens).toBeGreaterThan(0);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('summary block');
  });

  it('should still refresh budget when summary is disabled', async () => {
    const middleware = createConversationContextMiddleware();
    const pipeline = new MiddlewarePipeline([middleware]);
    const messages: BaseMessage[] = [new HumanMessage('hello')];

    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {context: {}},
      systemMessage: ['caller prompt'],
      runId: 'run-2',
      turn: 1,
      maxTurns: 8,
      requestId: 'req-2',
      inputBudget: {
        maxInputTokens: 40,
      },
    };

    await pipeline.beforeModel(context);

    expect(context.budget).toBeDefined();
    expect(readSummaryRecord(context.state.messages)).toBeUndefined();
  });

  it('should force summary compaction when runtime requests manual compact', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 99,
        keepLastMessages: 2,
        summarize: () => 'manual summary block',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
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
      runtime: {
        context: {
          codara: {
            forceCompactConversation: true,
          },
        },
      },
      systemMessage: ['caller prompt'],
      runId: 'run-3',
      turn: 1,
      maxTurns: 8,
      requestId: 'req-3',
      inputBudget: {
        maxInputTokens: 400,
      },
    };

    await pipeline.beforeModel(context);

    expect(readSummaryRecord(context.state.messages)?.content).toBe('manual summary block');
  });
});

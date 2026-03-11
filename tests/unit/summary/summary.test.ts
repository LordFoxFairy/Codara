import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {estimateModelInputTokens} from '@core/middleware/context-budget';
import {createConversationContextMiddleware, type ModelCallContext} from '@core/middleware';
import {MiddlewarePipeline} from '@core/middleware/pipeline';
import {readSummaryRecord} from '@core/middleware/summary';

class FakeModel {
  constructor(private readonly responses: AIMessage[]) {}

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No fake response available');
    }
    return response;
  }

  bindTools(): this {
    return this;
  }
}

function createExecution(
  threadId: string,
  runId: string,
  turn: number,
  requestId: string,
  maxTurns: number = 8,
) {
  return {threadId, runId, turn, maxTurns, requestId};
}

describe('summary middleware', () => {
  it('should summarize older messages and replace them inside state.messages', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        summarize: ({messages, previousSummary}) => {
          expect(previousSummary).toBeUndefined();
          expect(messages).toHaveLength(3);
          return 'older conversation summary';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
      systemMessage: [],
      execution: {
        threadId: 'thread-1',
        runId: 'run-1',
        turn: 2,
        maxTurns: 8,
        requestId: 'req-1',
      },
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(3);
    expect(context.state.messages[0]).toBeInstanceOf(SystemMessage);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('older conversation summary');
    expect(String(context.state.messages[1]?.content)).toBe('four');
    expect(String(context.state.messages[2]?.content)).toBe('five');
    expect(context.systemMessage).toEqual([]);
  });

  it('should keep an existing summary message without recomputing it', async () => {
    let called = false;
    const middleware = createConversationContextMiddleware({
      summary: {
        summarize: () => {
          called = true;
          return 'should-not-run';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
      new SystemMessage([
        '# Conversation Summary',
        '',
        'The following summary captures earlier conversation context that has been compacted.',
        '',
        'existing summary',
      ].join('\n')),
      new HumanMessage('recent'),
    ];
    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {context: {}},
      systemMessage: [],
      execution: createExecution('thread-existing', 'run-1', 1, 'req-1'),
    };

    await pipeline.beforeModel(context);

    expect(called).toBe(false);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('existing summary');
    expect(readSummaryRecord(context.state.messages)?.summarizedMessages).toBe(0);
    expect(context.systemMessage).toEqual([]);
  });

  it('should preserve caller system messages ahead of the compacted summary', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        summarize: () => 'older conversation summary',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
      new SystemMessage('caller instructions'),
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
      systemMessage: [],
      execution: createExecution('thread-caller', 'run-1', 2, 'req-1'),
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(4);
    expect(String(context.state.messages[0]?.content)).toBe('caller instructions');
    expect(context.state.messages[1]).toBeInstanceOf(SystemMessage);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('older conversation summary');
  });

  it('should compact against the full model input budget, including injected system messages', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 10,
        keepLastMessages: 2,
        estimateTokens: ({systemMessage, messages}) =>
          estimateModelInputTokens({systemMessage, messages}),
        summarize: () => 'budget summary',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
      execution: createExecution('thread-budget', 'run-budget', 1, 'req-budget'),
      inputBudget: {maxInputTokens: 40},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryRecord(context.state.messages)?.content).toBe('budget summary');
    expect(context.state.messages[0]).toBeInstanceOf(SystemMessage);
    expect(context.state.messages).toHaveLength(3);
  });

  it('should compact before the prompt is completely full when the budget threshold is reached', async () => {
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 10,
        keepLastMessages: 2,
        compactThresholdRatio: 0.8,
        estimateTokens: ({systemMessage, messages}) =>
          estimateModelInputTokens({systemMessage, messages}),
        summarize: () => 'threshold summary',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
      systemMessage: ['x'.repeat(80)],
      execution: createExecution('thread-threshold', 'run-threshold', 1, 'req-threshold'),
      inputBudget: {maxInputTokens: 60},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryRecord(context.state.messages)?.content).toBe('threshold summary');
  });

  it('should default to compacting near the end of the context window', async () => {
    const middleware = createConversationContextMiddleware({
      estimateTokens: () => 96,
      summary: {
        maxMessages: 10,
        keepLastMessages: 2,
        estimateTokens: () => 96,
        summarize: () => 'near-limit summary',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
      systemMessage: [],
      execution: createExecution('thread-near-limit', 'run-near-limit', 1, 'req-near-limit'),
      inputBudget: {maxInputTokens: 100},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryRecord(context.state.messages)?.content).toBe('near-limit summary');
  });

  it('should forward manual compact instructions to the summary generator', async () => {
    let seenInstructions: string | undefined;
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        summarize: ({instructions}) => {
          seenInstructions = instructions;
          return 'instruction-aware summary';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
            compactInstructions: 'focus on decisions only',
          },
        },
      },
      systemMessage: [],
      execution: createExecution('thread-instructions', 'run-instructions', 1, 'req-instructions'),
    };

    await pipeline.beforeModel(context);

    expect(seenInstructions).toBe('focus on decisions only');
    expect(readSummaryRecord(context.state.messages)?.content).toBe('instruction-aware summary');
  });

  it('should preserve the full summary across later compactions even when model-visible content is truncated', async () => {
    const seenPreviousSummaries: Array<string | undefined> = [];
    const middleware = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        maxChars: 12,
        summarize: ({previousSummary}) => {
          seenPreviousSummaries.push(previousSummary);
          return previousSummary
            ? `${previousSummary} + second full summary block`
            : 'first full summary block';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [
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
      systemMessage: [],
      execution: createExecution('thread-summary-loop', 'run-1', 1, 'req-1'),
    };

    await pipeline.beforeModel(context);
    context.state.messages.push(new AIMessage('six'), new HumanMessage('seven'), new AIMessage('eight'));
    context.messages.length = 0;
    context.messages.push(...context.state.messages);

    await pipeline.beforeModel({
      ...context,
      execution: createExecution('thread-summary-loop', 'run-1', 2, 'req-1'),
    });

    expect(seenPreviousSummaries).toEqual([undefined, 'first full summary block']);
    expect(readSummaryRecord(context.state.messages)?.content).toContain('first full summary block + second full summary block');
    expect(String(context.state.messages[0]?.content)).toContain('[truncated]');
  });

  it('should persist summary through checkpoint restore', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const summary = createConversationContextMiddleware({
      summary: {
        maxMessages: 4,
        keepLastMessages: 2,
        summarize: () => 'persisted summary',
      },
    });

    const agent = createAgent({
      model,
      checkpointer,
      threadId: 'summary-thread',
      middleware: [summary],
    });

    const result = await agent.invoke({
      messages: [
        new HumanMessage('one'),
        new AIMessage('two'),
        new HumanMessage('three'),
        new AIMessage('four'),
        new HumanMessage('five'),
      ],
    });

    expect(result.reason).toBe('complete');
    expect(agent.getState().messages).toHaveLength(4);
    expect(readSummaryRecord(agent.getState().messages)?.content).toBe('persisted summary');
    expect(readSummaryRecord(agent.getState().messages)?.summarizedMessages).toBe(3);

    const restoredCheckpoint = await checkpointer.getLatest('summary-thread');
    expect(restoredCheckpoint).toBeDefined();

    const restored = createAgent({
      model: new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'summary-thread',
      checkpoint: restoredCheckpoint,
      middleware: [summary],
    });

    expect(readSummaryRecord(restored.getState().messages)?.content).toBe('persisted summary');
    expect(restored.getState().messages).toHaveLength(4);
  });

  it('should provide the real agent threadId to the summary generator without caller-injected runtime context', async () => {
    let seenThreadId: string | undefined;
    const agent = createAgent({
      model: new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel,
      threadId: 'summary-real-thread',
      middleware: [
        createConversationContextMiddleware({
          summary: {
            maxMessages: 4,
            keepLastMessages: 2,
            summarize: ({threadId}) => {
              seenThreadId = threadId;
              return 'thread-aware summary';
            },
          },
        }),
      ],
    });

    const result = await agent.invoke({
      messages: [
        new HumanMessage('one'),
        new AIMessage('two'),
        new HumanMessage('three'),
        new AIMessage('four'),
        new HumanMessage('five'),
      ],
    });

    expect(result.reason).toBe('complete');
    expect(seenThreadId).toBe('summary-real-thread');
  });
});

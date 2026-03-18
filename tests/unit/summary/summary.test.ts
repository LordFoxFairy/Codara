import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agent';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint';
import {createBudgetMiddleware, type ModelCallContext} from '@core/middleware';
import {MiddlewarePipeline} from '@core/pipeline/pipeline';
import {createSummaryMiddleware} from '@core/middleware/summary';

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
  sessionId: string,
  runId: string,
  turn: number,
  requestId: string,
  maxTurns: number = 8,
) {
  return {sessionId, runId, turn, maxTurns, requestId};
}

function readSummaryMessage(messages: BaseMessage[]): BaseMessage | undefined {
  return messages.find((message) => message.type === 'ai' && message.text.startsWith('Summary:\n'));
}

describe('summary middleware', () => {
  it('should summarize older messages and replace them inside state.messages', async () => {
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: ({messages}) => {
          expect(messages).toHaveLength(3);
          return 'older conversation summary';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware!]);
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
      execution: {
        sessionId: 'session-1',
        runId: 'run-1',
        turn: 2,
        maxTurns: 8,
        requestId: 'req-1',
      },
      inputBudget: {maxInputTokens: 20},
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(3);
    expect(context.state.messages[0]).toBeInstanceOf(AIMessage);
    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nolder conversation summary');
    expect(String(context.state.messages[1]?.content)).toBe('four');
    expect(String(context.state.messages[2]?.content)).toBe('five');
    expect(context.systemMessage).toEqual(['x'.repeat(120)]);
  });

  it('should preserve caller system messages ahead of the compacted summary', async () => {
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: () => 'older conversation summary',
      },
    });

    const pipeline = new MiddlewarePipeline([middleware!]);
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
      systemMessage: ['x'.repeat(120)],
      execution: createExecution('session-caller', 'run-1', 2, 'req-1'),
      inputBudget: {maxInputTokens: 20},
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(4);
    expect(String(context.state.messages[0]?.content)).toBe('caller instructions');
    expect(context.state.messages[1]).toBeInstanceOf(AIMessage);
    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nolder conversation summary');
  });

  it('should compact against the full model input budget, including injected system messages', async () => {
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: () => 'budget summary',
      },
    });

    const pipeline = new MiddlewarePipeline([createBudgetMiddleware(), middleware!]);
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
      execution: createExecution('session-budget', 'run-budget', 1, 'req-budget'),
      inputBudget: {maxInputTokens: 40},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nbudget summary');
    expect(context.state.messages[0]).toBeInstanceOf(AIMessage);
    expect(context.state.messages).toHaveLength(3);
  });

  it('should compact before the prompt is completely full when the budget threshold is reached', async () => {
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: () => 'threshold summary',
      },
    });

    const pipeline = new MiddlewarePipeline([createBudgetMiddleware(), middleware!]);
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
      systemMessage: ['x'.repeat(40)],
      execution: createExecution('session-threshold', 'run-threshold', 1, 'req-threshold'),
      inputBudget: {maxInputTokens: 40},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nthreshold summary');
  });

  it('should default to compacting near the end of the context window', async () => {
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: () => 'near-limit summary',
      },
    });

    const pipeline = new MiddlewarePipeline([createBudgetMiddleware(), middleware!]);
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
      execution: createExecution('session-near-limit', 'run-near-limit', 1, 'req-near-limit'),
      inputBudget: {maxInputTokens: 20},
    };

    await pipeline.beforeModel(context);

    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nnear-limit summary');
  });

  it('should keep compacting by replacing earlier messages', async () => {
    const seenInputs: string[] = [];
    const middleware = createSummaryMiddleware({
      summary: {
        summarize: ({messages}) => {
          seenInputs.push(messages.map((message) => message.text).join('|'));
          return seenInputs.length === 1 ? 'first summary block' : 'second summary block';
        },
      },
    });

    const pipeline = new MiddlewarePipeline([middleware!]);
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
      execution: createExecution('session-summary-loop', 'run-1', 1, 'req-1'),
      inputBudget: {maxInputTokens: 20},
    };

    await pipeline.beforeModel(context);
    context.state.messages.push(new AIMessage('six'), new HumanMessage('seven'), new AIMessage('eight'));
    context.messages = context.state.messages;

    await pipeline.beforeModel({
      ...context,
      execution: createExecution('session-summary-loop', 'run-1', 2, 'req-1'),
      inputBudget: {maxInputTokens: 20},
    });

    expect(seenInputs).toHaveLength(2);
    expect(readSummaryMessage(context.state.messages)?.text).toBe('Summary:\nsecond summary block');
  });

  it('should persist summary through checkpoint restore', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const summary = createSummaryMiddleware({
      summary: {
        summarize: () => 'persisted summary',
      },
    });

    const agent = createAgent({
      model,
      checkpointer,
      sessionId: 'summary-session',
      inputBudget: {maxInputTokens: 20},
      middleware: [summary!],
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
    expect(readSummaryMessage(agent.getState().messages)?.text).toBe('Summary:\npersisted summary');

    const restoredCheckpoint = await checkpointer.getLatest('summary-session');
    expect(restoredCheckpoint).toBeDefined();

    const restored = createAgent({
      model: new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      sessionId: 'summary-session',
      checkpoint: restoredCheckpoint,
      middleware: [summary!],
    });

    expect(readSummaryMessage(restored.getState().messages)?.text).toBe('Summary:\npersisted summary');
    expect(restored.getState().messages).toHaveLength(4);
  });

  it('should provide the real agent sessionId to the summary generator without caller-injected runtime context', async () => {
    let seenSessionId: string | undefined;
    const agent = createAgent({
      model: new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel,
      sessionId: 'summary-real-session',
      inputBudget: {maxInputTokens: 20},
      middleware: [
        createSummaryMiddleware({
          summary: {
            summarize: ({sessionId}) => {
              seenSessionId = sessionId;
              return 'session-aware summary';
            },
          },
        })!,
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
    expect(seenSessionId).toBe('summary-real-session');
  });
});

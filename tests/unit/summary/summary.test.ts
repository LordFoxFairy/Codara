import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgent} from '@core/agents';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';
import {MiddlewarePipeline, type ModelCallContext} from '@core/middleware';
import {createSummaryMiddleware, readSummaryRecord} from '@core/middleware/summary';

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

describe('summary middleware', () => {
  it('should summarize older messages, trim history, and inject the summary', async () => {
    const middleware = createSummaryMiddleware({
      maxMessages: 4,
      keepLastMessages: 2,
      summarize: ({messages, previousSummary}) => {
        expect(previousSummary).toBeUndefined();
        expect(messages).toHaveLength(3);
        return 'older conversation summary';
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
      runtime: {context: {threadId: 'thread-1'}, agentContext: {}},
      systemMessage: [],
      runId: 'run-1',
      turn: 2,
      maxTurns: 8,
      requestId: 'req-1',
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(2);
    expect(String(context.state.messages[0]?.content)).toBe('four');
    expect(String(context.state.messages[1]?.content)).toBe('five');
    expect(readSummaryRecord(context.runtime.agentContext ?? {})?.content).toBe('older conversation summary');
    expect(context.systemMessage[0]).toContain('Conversation Summary');
    expect(context.systemMessage[0]).toContain('older conversation summary');
  });

  it('should inject an existing summary without recomputing it', async () => {
    let called = false;
    const middleware = createSummaryMiddleware({
      summarize: () => {
        called = true;
        return 'should-not-run';
      },
    });

    const pipeline = new MiddlewarePipeline([middleware]);
    const messages = [new HumanMessage('recent')];
    const context: ModelCallContext = {
      state: {messages},
      messages,
      runtime: {
        context: {
          codara: {
            summary: {
              content: 'existing summary',
              updatedAt: '2026-03-08T00:00:00.000Z',
              summarizedMessages: 4,
            },
          },
        },
      },
      systemMessage: [],
      runId: 'run-1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req-1',
    };

    await pipeline.beforeModel(context);

    expect(called).toBe(false);
    expect(context.systemMessage[0]).toContain('existing summary');
  });

  it('should persist summary through checkpoint restore', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel;
    const summary = createSummaryMiddleware({
      maxMessages: 4,
      keepLastMessages: 2,
      summarize: () => 'persisted summary',
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
    expect(agent.getState().messages).toHaveLength(3);
    expect(readSummaryRecord(agent.getState().context)?.content).toBe('persisted summary');

    const restoredCheckpoint = await checkpointer.getLatest('summary-thread');
    expect(restoredCheckpoint).toBeDefined();

    const restored = createAgent({
      model: new FakeModel([new AIMessage('done')]) as unknown as BaseChatModel,
      checkpointer,
      threadId: 'summary-thread',
      checkpoint: restoredCheckpoint,
      middleware: [summary],
    });

    expect(readSummaryRecord(restored.getState().context)?.content).toBe('persisted summary');
    expect(restored.getState().messages).toHaveLength(3);
  });
});

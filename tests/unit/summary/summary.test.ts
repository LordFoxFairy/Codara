import {describe, expect, it} from 'bun:test';
import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
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
  it('should summarize older messages and replace them inside state.messages', async () => {
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

    expect(context.state.messages).toHaveLength(3);
    expect(context.state.messages[0]).toBeInstanceOf(SystemMessage);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('older conversation summary');
    expect(String(context.state.messages[1]?.content)).toBe('four');
    expect(String(context.state.messages[2]?.content)).toBe('five');
    expect(context.systemMessage).toEqual([]);
  });

  it('should keep an existing summary message without recomputing it', async () => {
    let called = false;
    const middleware = createSummaryMiddleware({
      summarize: () => {
        called = true;
        return 'should-not-run';
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
      runId: 'run-1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req-1',
    };

    await pipeline.beforeModel(context);

    expect(called).toBe(false);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('existing summary');
    expect(context.systemMessage).toEqual([]);
  });

  it('should preserve caller system messages ahead of the compacted summary', async () => {
    const middleware = createSummaryMiddleware({
      maxMessages: 4,
      keepLastMessages: 2,
      summarize: () => 'older conversation summary',
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
      runId: 'run-1',
      turn: 2,
      maxTurns: 8,
      requestId: 'req-1',
    };

    await pipeline.beforeModel(context);

    expect(context.state.messages).toHaveLength(4);
    expect(String(context.state.messages[0]?.content)).toBe('caller instructions');
    expect(context.state.messages[1]).toBeInstanceOf(SystemMessage);
    expect(readSummaryRecord(context.state.messages)?.content).toBe('older conversation summary');
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
    expect(agent.getState().messages).toHaveLength(4);
    expect(readSummaryRecord(agent.getState().messages)?.content).toBe('persisted summary');

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
});

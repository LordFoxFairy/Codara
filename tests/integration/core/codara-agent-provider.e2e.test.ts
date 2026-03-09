import {describe, expect, it} from 'bun:test';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import {createCodara, type MiddlewareLogRecord} from '@core';

class InvokeOnceModel {
  bindTools(): this {
    return this;
  }

  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    void messages;
    return new AIMessage('OK');
  }

  async stream(messages: BaseMessage[]): Promise<AsyncGenerator<AIMessageChunk>> {
    void messages;
    return (async function* () {
      yield new AIMessageChunk('OK');
    })();
  }
}

describe('Codara facade integration', () => {
  it('should invoke through createCodara().invoke with logging', async () => {
    const logs: MiddlewareLogRecord[] = [];

    const codara = createCodara({
      modelResolver: async () => new InvokeOnceModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
      logging: {
        enabled: true,
        level: 'debug',
        logger: (record) => {
          logs.push(record);
        },
      },
    });

    const result = await codara.invoke('只回复 OK，不要调用任何工具。');

    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content).trim().length).toBeGreaterThan(0);
    expect(logs.some((record) => record.stage === 'wrapModelCall' && record.event === 'stage_start')).toBe(true);
    expect(logs.some((record) => record.stage === 'afterAgent' && record.resultReason === 'complete')).toBe(true);
  });

  it('should stream message chunks through createCodara().stream', async () => {
    const codara = createCodara({
      modelResolver: async () => new InvokeOnceModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('只回复 OK，不要调用任何工具。', {streamMode: 'messages'})) {
      // 直接使用 AIMessageChunk（对齐 LangChain 标准）
      const messageChunk = chunk as AIMessageChunk;
      chunks.push(String(messageChunk.content ?? ''));
    }

    expect(chunks.join('').trim().length).toBeGreaterThan(0);
    const session = await codara.session();
    expect(session.getState().sessionStatus).toBe('ready');
    expect(session.agent().getState().messages.length).toBeGreaterThanOrEqual(2);
  });

  it('should stream with proper LangChain message format and block types', async () => {
    const codara = createCodara({
      modelResolver: async () => new InvokeOnceModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    const streamedChunks: AIMessageChunk[] = [];

    // Test stream iteration with for-await-of（对齐 LangChain 标准）
    for await (const chunk of codara.stream('回复一句话即可', {streamMode: 'messages'})) {
      const messageChunk = chunk as AIMessageChunk;

      // Verify message chunk structure (LangChain AIMessageChunk)
      expect(messageChunk).toBeDefined();
      expect(messageChunk.content).toBeDefined();

      // Verify metadata is in response_metadata (LangChain 标准字段)
      expect(messageChunk.response_metadata).toBeDefined();
      expect(typeof messageChunk.response_metadata.runId).toBe('string');
      expect(typeof messageChunk.response_metadata.turn).toBe('number');
      expect(messageChunk.response_metadata.turn).toBeGreaterThanOrEqual(0);

      streamedChunks.push(messageChunk);
    }

    // Verify we received chunks
    expect(streamedChunks.length).toBeGreaterThan(0);

    // Verify content is not empty
    const fullContent = streamedChunks
      .map((c) => String(c.content ?? ''))
      .join('')
      .trim();
    expect(fullContent.length).toBeGreaterThan(0);

    // Verify final state
    const session = await codara.session();
    const state = session.agent().getState();

    // Verify messages array follows LangChain BaseMessage format
    expect(state.messages.length).toBeGreaterThanOrEqual(2);

    // Check last message (AI response)
    const lastMessage = state.messages[state.messages.length - 1];
    expect(lastMessage).toBeDefined();
    expect(lastMessage.content).toBeDefined();

    // Verify message has LangChain-compatible structure
    // BaseMessage should have: content, additional_kwargs, response_metadata, etc.
    expect('content' in lastMessage).toBe(true);
    expect(typeof lastMessage.content === 'string' || Array.isArray(lastMessage.content)).toBe(true);
  });
});

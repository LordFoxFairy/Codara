import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer, createCodara} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessageChunk} from '@langchain/core/messages';
import {EchoModel, StreamingEchoModel} from './codara-fixtures';

describe('Codara facade runtime', () => {
  it('should create a Codara session through the facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new EchoModel();

    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      threadId: 'core-facade-thread',
      checkpointer,
      skills: false,
    });

    const first = await codara.invoke('hello');
    expect(first.reason).toBe('complete');
    expect(String(first.state.messages[first.state.messages.length - 1]?.content)).toBe('seen_humans:1');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');
  });

  it('should expose a high-level invoke API through createCodara()', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.invoke('hello');
    expect(result.reason).toBe('complete');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should allow a modelResolver override without changing the main createCodara API', async () => {
    const model = new EchoModel();
    const codara = createCodara({
      modelResolver: async () => model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.invoke('hello');
    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
  });

  it('should recreate the agent after reset', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');
    await codara.reset();

    const result = await codara.invoke('again');
    expect(result.reason).toBe('complete');

    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should stream through the top-level Codara facade for CLI consumers', async () => {
    const model = new StreamingEchoModel();
    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const chunks: string[] = [];
    for await (const chunk of codara.stream('hello', {streamMode: 'messages'})) {
      const messageChunk = chunk as AIMessageChunk;
      chunks.push(String(messageChunk.content));
    }

    expect(chunks).toEqual(['seen_humans:1']);
    const state = codara.getState();
    expect(state.sessionStatus).toBe('ready');

    const agentState = codara.getAgentState();
    expect(agentState.messages).toHaveLength(2);
    expect(String(agentState.messages[1]?.content)).toBe('seen_humans:1');
  });
});

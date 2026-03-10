import {describe, expect, it} from 'bun:test';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgentMemoryCheckpointer, createCodara} from '@core';
import {EchoModel} from './codara-fixtures';

describe('Codara session fork', () => {
  it('should fork the current conversation into a new branch with a new thread id', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');

    const sourceSession = codara.getState();
    const sourceAgentState = codara.getAgentState();
    const fork = await codara.fork();

    expect(fork.getState().sessionId).not.toBe(sourceSession.sessionId);
    expect(fork.getState().threadId).not.toBe(sourceSession.threadId);
    expect(fork.getState().metadata?.forkedFromSessionId).toBe(sourceSession.sessionId);
    expect(fork.getState().metadata?.forkedFromThreadId).toBe(sourceSession.threadId);
    expect(fork.getAgentState().messages).toEqual(sourceAgentState.messages);

    await fork.invoke('branch');

    expect(fork.getAgentState().messages.length).toBeGreaterThan(sourceAgentState.messages.length);
    expect(codara.getAgentState().messages).toEqual(sourceAgentState.messages);
  });
});

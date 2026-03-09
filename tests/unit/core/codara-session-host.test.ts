import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer, createCodara} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {EchoModel} from './codara-fixtures';

describe('Codara session host', () => {
  it('should create and reload sessions through the high-level Codara facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const firstCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-session-thread',
      checkpointer,
      skills: false,
      builtinTools: false,
    });
    await firstCodara.invoke('hello');

    const secondCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-session-thread',
      checkpointer,
      restore: 'latest',
      skills: false,
      builtinTools: false,
    });

    // Trigger agent initialization to load checkpoint
    await secondCodara.invoke('test');

    const restoredAgentState = secondCodara.getAgentState();
    expect(restoredAgentState.messages.length).toBeGreaterThanOrEqual(2);
    expect(String(restoredAgentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should open an existing session when thread checkpoints already exist', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const firstCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      threadId: 'codara-open-thread',
      skills: false,
      builtinTools: false,
    });

    await firstCodara.invoke('hello');

    const secondCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      threadId: 'codara-open-thread',
      restore: 'latest',
      skills: false,
      builtinTools: false,
    });

    const restoredState = secondCodara.getState();
    expect(restoredState.sessionStatus).toBe('ready');

    // Trigger agent initialization to load checkpoint
    await secondCodara.invoke('test');

    const restoredAgentState = secondCodara.getAgentState();
    expect(restoredAgentState.messages.length).toBeGreaterThanOrEqual(2);
    expect(String(restoredAgentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should open a new session when the target thread does not exist yet', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer: createAgentMemoryCheckpointer(),
      threadId: 'brand-new-thread',
      skills: false,
      builtinTools: false,
    });

    const state = codara.getState();
    expect(state.threadId).toBe('brand-new-thread');

    // Trigger agent initialization
    await codara.invoke('test');
    expect(codara.getAgentState().messages.length).toBeGreaterThan(0);
  });
});

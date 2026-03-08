import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer, createCodara} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {EchoModel} from './codara-fixtures';

describe('Codara session host', () => {
  it('should create and reload sessions through the high-level Codara facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    const session = await codara.session({
      threadId: 'codara-session-thread',
    });
    await session.agent().invoke('hello');

    const restored = await codara.session({
      threadId: 'codara-session-thread',
    });

    expect(restored).toBeDefined();
    const restoredAgentState = restored?.agent().getState();
    expect(restoredAgentState?.messages).toHaveLength(2);
    expect(String(restoredAgentState?.messages[1]?.content)).toBe('seen_humans:1');
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
      skills: false,
      builtinTools: false,
    });

    const restoredState = await secondCodara.getState();
    expect(restoredState.sessionStatus).toBe('ready');

    const restoredAgentState = (await secondCodara.session()).agent().getState();
    expect(restoredAgentState.messages).toHaveLength(2);
    expect(String(restoredAgentState.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should open a new session when the target thread does not exist yet', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer: createAgentMemoryCheckpointer(),
      skills: false,
      builtinTools: false,
    });

    const session = await codara.session({
      threadId: 'brand-new-thread',
    });

    const state = session.getState();
    expect(state.threadId).toBe('brand-new-thread');
    expect(session.agent().getState().messages).toHaveLength(0);
  });
});

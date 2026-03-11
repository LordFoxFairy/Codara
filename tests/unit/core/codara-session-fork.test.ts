import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAgentMemoryCheckpointer, createCodara, FileSessionStore, openCodaraSession} from '@core';
import {EchoModel} from './codara-fixtures';
import {AIMessage} from '@langchain/core/messages';

class UsageModel {
  async invoke(): Promise<AIMessage> {
    return new AIMessage({
      content: 'done',
      usage_metadata: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
      },
    });
  }

  bindTools(): this {
    return this;
  }
}

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

  it('should persist a forked branch before the child sends a new message', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-fork-store-')),
    });
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      store,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');

    const fork = await codara.fork({store});
    const forkSessionId = fork.getState().sessionId;
    const forkMessages = fork.getAgentState().messages;

    const reopened = await openCodaraSession({
      sessionId: forkSessionId,
      store,
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    expect(reopened.getAgentState().messages).toEqual(forkMessages);
    expect((await checkpointer.getLatest(fork.getState().threadId))?.info.source).toBe('fork');
  });

  it('should not inherit cumulative parent usage telemetry into a forked session host', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const codara = createCodara({
      model: new UsageModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('hello');
    expect(codara.getState().metadata?.usage?.totalTokens).toBe(150);

    const fork = await codara.fork();

    expect(fork.getState().metadata?.usage).toBeUndefined();
    expect(fork.getState().metadata?.forkedFromSessionId).toBe(codara.getState().sessionId);
  });
});

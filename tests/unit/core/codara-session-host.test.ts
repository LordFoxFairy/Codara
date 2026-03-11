import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  createAgentMemoryCheckpointer,
  createCodara,
  FileSessionStore,
  openCodaraSession,
  openLatestCodaraSession,
} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {EchoModel} from './codara-fixtures';

describe('Codara session host', () => {
  it('should reopen a stored session by session id', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-store-')),
    });

    const firstCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-session-thread',
      checkpointer,
      store,
      skills: false,
      builtinTools: false,
    });
    const firstResult = await firstCodara.invoke('hello');
    const sessionId = firstCodara.getState().sessionId;
    expect(firstResult.reason).toBe('complete');

    const secondCodara = await openCodaraSession({
      sessionId,
      store,
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    const hydratedState = secondCodara.getAgentState();
    expect(hydratedState.messages.length).toBeGreaterThanOrEqual(2);
    expect(String(hydratedState.messages[1]?.content)).toBe('seen_humans:1');

    await secondCodara.invoke('test');

    const restoredAgentState = secondCodara.getAgentState();
    expect(restoredAgentState.messages.length).toBe(hydratedState.messages.length + 2);
    expect(String(restoredAgentState.messages[1]?.content)).toBe('seen_humans:1');
    expect(restoredAgentState.messages.at(-2)?.getType()).toBe('human');
    expect(restoredAgentState.messages.at(-1)?.getType()).toBe('ai');
  });

  it('should open the latest stored session explicitly', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-latest-')),
    });

    const firstCodara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      threadId: 'codara-open-thread',
      store,
      skills: false,
      builtinTools: false,
    });

    await firstCodara.invoke('hello');

    const secondCodara = await openLatestCodaraSession({
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      store,
      skills: false,
      builtinTools: false,
    });

    const restoredState = secondCodara.getState();
    expect(restoredState.sessionStatus).toBe('ready');
    expect(restoredState.metadata?.messageCount).toBeGreaterThanOrEqual(2);

    const hydratedState = secondCodara.getAgentState();
    expect(hydratedState.messages.length).toBeGreaterThanOrEqual(2);
    expect(String(hydratedState.messages[1]?.content)).toBe('seen_humans:1');

    await secondCodara.invoke('test');

    const restoredAgentState = secondCodara.getAgentState();
    expect(restoredAgentState.messages.length).toBe(hydratedState.messages.length + 2);
    expect(String(restoredAgentState.messages[1]?.content)).toBe('seen_humans:1');
    expect(restoredAgentState.messages.at(-2)?.getType()).toBe('human');
    expect(restoredAgentState.messages.at(-1)?.getType()).toBe('ai');
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

  it('should hydrate a restoring session without requiring a new invoke', async () => {
    const checkpointer = createAgentMemoryCheckpointer();

    const original = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-hydrate-thread',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await original.invoke('hello');

    const restored = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-hydrate-thread',
      restore: 'latest',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    const hydratedState = await restored.hydrate();
    expect(hydratedState.messages.length).toBeGreaterThanOrEqual(2);
    expect(String(hydratedState.messages[1]?.content)).toBe('seen_humans:1');
    expect(restored.getState().metadata?.messageCount).toBe(hydratedState.messages.length);
  });

  it('should not treat hydrate as new host activity when reopening a stored session', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-hydrate-activity-')),
    });

    const original = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      sessionId: 'hydrate-activity-session',
      threadId: 'hydrate-activity-thread',
      store,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await original.invoke('hello');
    const beforeReopen = await store.get('hydrate-activity-session');
    expect(beforeReopen).toBeDefined();
    await Bun.sleep(10);

    const restored = await openCodaraSession({
      sessionId: 'hydrate-activity-session',
      store,
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    const afterReopen = await store.get('hydrate-activity-session');
    expect(restored.getAgentState().messages.length).toBeGreaterThanOrEqual(2);
    expect(afterReopen?.updatedAt).toBe(beforeReopen?.updatedAt);
    expect(afterReopen?.metadata?.lastActivity).toBe(beforeReopen?.metadata?.lastActivity);
  });

  it('should reset a restoring session even before the agent is explicitly hydrated', async () => {
    const checkpointer = createAgentMemoryCheckpointer();

    const original = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-reset-before-hydrate-thread',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await original.invoke('hello');

    const restored = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-reset-before-hydrate-thread',
      restore: 'latest',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await restored.reset();
    const result = await restored.invoke('again');

    expect(result.reason).toBe('complete');
    expect(result.state.messages).toHaveLength(2);
    expect(String(result.state.messages[0]?.content)).toBe('again');
    expect(String(result.state.messages[1]?.content)).toBe('seen_humans:1');
  });

  it('should dispose a restoring session branch even before the agent is explicitly hydrated', async () => {
    const checkpointer = createAgentMemoryCheckpointer();

    const original = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-dispose-before-hydrate-thread',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await original.invoke('hello');

    const restored = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-dispose-before-hydrate-thread',
      restore: 'latest',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await restored.dispose();

    const reopened = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      threadId: 'codara-dispose-before-hydrate-thread',
      restore: 'latest',
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await expect(reopened.invoke('again')).rejects.toThrow('Agent is closed.');
  });

  it('should reopen a disposed stored session with a new ready host lifecycle', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const store = new FileSessionStore({
      basePath: await mkdtemp(path.join(tmpdir(), 'codara-session-reopen-disposed-')),
    });

    const original = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      sessionId: 'disposed-session-reopen',
      threadId: 'disposed-session-thread',
      store,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    await original.invoke('hello');
    await original.dispose();

    const reopened = await openCodaraSession({
      sessionId: 'disposed-session-reopen',
      store,
      model: new EchoModel() as unknown as BaseChatModel,
      checkpointer,
      skills: false,
      builtinTools: false,
    });

    expect(reopened.getState().sessionStatus).toBe('ready');
    expect(reopened.getAgentState().status).toBe('closed');
  });
});

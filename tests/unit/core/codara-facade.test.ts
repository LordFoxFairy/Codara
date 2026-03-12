import {describe, expect, it} from 'bun:test';
import {createAgentMemoryCheckpointer, createCodara, createCodaraHost} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessageChunk} from '@langchain/core/messages';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EchoModel, StreamingEchoModel} from './codara-fixtures';

describe('Codara facade runtime', () => {
  it('should create a Codara session through the facade', async () => {
    const checkpointer = createAgentMemoryCheckpointer();
    const model = new EchoModel();

    const codara = createCodara({
      model: model as unknown as BaseChatModel,
      sessionId: 'core-facade-session',
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

  it('should allow an async model without adding a second model entry path', async () => {
    const model = new EchoModel();
    const codara = createCodara({
      model: Promise.resolve(model as unknown as BaseChatModel),
      skills: false,
      builtinTools: false,
    });

    const result = await codara.invoke('hello');
    expect(result.reason).toBe('complete');
    expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
  });

  it('should not require a home config when an explicit model is provided', async () => {
    const originalHome = process.env.HOME;
    const originalCodaraPath = process.env.CODARA_PATH;
    const isolatedHome = await mkdtemp(path.join(tmpdir(), 'codara-no-home-config-'));

    process.env.HOME = isolatedHome;
    delete process.env.CODARA_PATH;

    try {
      const codara = createCodara({
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');
      expect(String(result.state.messages[result.state.messages.length - 1]?.content)).toBe('seen_humans:1');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }

      if (originalCodaraPath === undefined) {
        delete process.env.CODARA_PATH;
      } else {
        process.env.CODARA_PATH = originalCodaraPath;
      }

      await rm(isolatedHome, {recursive: true, force: true});
    }
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

  it('should provide a core-owned persistent host entry for CLI consumers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-host-entry-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = createCodaraHost({
        cwd,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');

      const sessionId = codara.getState().sessionId;

      await expect(stat(path.join(codaraRoot, 'sessions', sessionId, 'metadata.json'))).resolves.toBeDefined();
      await expect(stat(path.join(codaraRoot, 'state', 'sessions', sessionId, 'latest.json'))).resolves.toBeDefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should write runtime logs to project .codara/logs/<sessionId>/YYYY-MM-DD.log by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-runtime-logs-'));
    const cwd = path.join(root, 'project');
    const codaraRoot = path.join(cwd, '.codara');

    await mkdir(cwd, {recursive: true});
    await mkdir(codaraRoot, {recursive: true});
    await writeFile(path.join(codaraRoot, 'config.json'), JSON.stringify({
      providers: [{name: 'test', apiKey: 'x', models: ['echo']}],
      router: {default: 'test:echo'},
    }, null, 2));

    try {
      const codara = createCodaraHost({
        cwd,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.invoke('hello');
      expect(result.reason).toBe('complete');

      const sessionId = codara.getState().sessionId;
      const logPath = path.join(codaraRoot, 'logs', sessionId, `${new Date().toISOString().slice(0, 10)}.log`);
      const content = await readFile(logPath, 'utf8');
      const records = content.trim().split('\n').map((line) => JSON.parse(line));

      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.sessionId === sessionId)).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should default sessionId and sessionId to the same identity source', () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const state = codara.getState();
    expect(state.sessionId).toBe(state.sessionId);
  });

  it('should accept a unified id for the public session identity', () => {
    const codara = createCodara({
      id: 'shared-id',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const state = codara.getState();
    expect(state.sessionId).toBe('shared-id');
    expect(state.sessionId).toBe('shared-id');
  });
});

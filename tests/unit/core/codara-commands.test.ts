import {describe, expect, it} from 'bun:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import {createCodara, createCodaraRuntime} from '@core';
import {EchoModel, SystemEchoModel} from './codara-fixtures';

describe('Codara slash commands', () => {
  function readSummaryMessage(messages: BaseMessage[]): BaseMessage | undefined {
    return messages.find((message) => message.getType() === 'ai' && message.text.startsWith('Summary:\n'));
  }

  it('should expose built-in slash command help', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/help');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('/help [command]');
    expect(result.output).toContain('/resume <sessionId>');
    expect(result.output).toContain('/compact [instructions] | /compact checkpoints [keepLast]');
    expect(result.output).toContain('/reload');
    expect((await codara.listCommands()).map((command) => ({
      name: command.name,
      source: command.source.type,
    }))).toEqual([
      {name: 'help', source: 'builtin'},
      {name: 'resume', source: 'builtin'},
      {name: 'compact', source: 'builtin'},
      {name: 'reload', source: 'builtin'},
    ]);
  });

  it('should reload session sources through slash commands without touching createAgent', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/reload');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS.md');
  });

  it('should compact the current conversation through the session-owned compact path', async () => {
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: () => 'manual compact summary',
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation context compacted');
    expect(readSummaryMessage(result.state?.messages ?? [])?.text).toBe('Summary:\nmanual compact summary');
  });

  it('should pass custom compact instructions into the summary middleware path', async () => {
    let seenInstructions: string | undefined;
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: ({instructions}) => {
          seenInstructions = instructions;
          return 'manual compact summary';
        },
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact focus on decisions and pending risks');

    expect(result.ok).toBe(true);
    expect(seenInstructions).toBe('focus on decisions and pending risks');
  });

  it('should compact checkpoint history through the slash command agent surface', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/compact checkpoints 5');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('latest 5 snapshots');
  });

  it('should return a clear error for unknown slash commands', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/missing');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Unknown command');
  });

  it('should return a resume_session action for a target stored session id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-resume-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    const current = createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      codaraPath,
      sessionId: 'current-session',
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });
    const target = createCodaraRuntime({
      cwd: projectRoot,
      projectRoot,
      codaraPath,
      sessionId: 'resume-target-session',
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    await current.invoke('current');
    await target.invoke('target');

    const result = await current.executeCommand('/resume resume-target-session');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('resume-target-session');
    expect(result.action).toEqual({
      type: 'resume_session',
      sessionId: 'resume-target-session',
    });
  });

  it('should reject /resume without a session id', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/resume');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Usage: /resume <sessionId>');
  });

  it('should report when /resume targets the current session', async () => {
    const codara = createCodara({
      sessionId: 'same-session',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/resume same-session');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Already using session same-session.');
    expect(result.action).toEqual({
      type: 'resume_session',
      sessionId: 'same-session',
    });
  });
});

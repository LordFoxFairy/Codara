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
    expect(result.output).toContain('/clear');
    expect(result.output).toContain('/status');
    expect(result.output).toContain('/memory [show|project|global]');
    expect(result.output).toContain('/permissions [show|edit]');
    expect(result.output).toContain('/resume <sessionId>');
    expect(result.output).toContain('/compact [instructions] | /compact checkpoints [keepLast]');
    expect(result.output).toContain('/reload');
    expect((await codara.listCommands()).map((command) => ({
      name: command.name,
      source: command.source.type,
    }))).toEqual([
      {name: 'help', source: 'builtin'},
      {name: 'clear', source: 'builtin'},
      {name: 'status', source: 'builtin'},
      {name: 'memory', source: 'builtin'},
      {name: 'permissions', source: 'builtin'},
      {name: 'resume', source: 'builtin'},
      {name: 'compact', source: 'builtin'},
      {name: 'reload', source: 'builtin'},
    ]);
  });

  it('should report the current runtime status through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-status-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      alias: 'sonnet',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('status me');

    const result = await codara.executeCommand('/status');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Runtime status:');
    expect(result.output).toContain('model: sonnet');
    expect(result.output).toContain('session_status: ready');
    expect(result.output).toContain('project_memory:');
    expect(result.output).toContain('permissions:');
  });

  it('should expose project and global memory targets through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-memory-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const show = await codara.executeCommand('/memory show');
    expect(show.ok).toBe(true);
    expect(show.output).toContain(path.join(projectRoot, 'AGENTS.md'));
    expect(show.output).toContain(path.join(userHome, '.codara', 'AGENTS.md'));

    const project = await codara.executeCommand('/memory project');
    expect(project.action).toEqual({
      type: 'open_file',
      path: path.join(projectRoot, 'AGENTS.md'),
    });

    const global = await codara.executeCommand('/memory global');
    expect(global.action).toEqual({
      type: 'open_file',
      path: path.join(userHome, '.codara', 'AGENTS.md'),
    });
  });

  it('should reload session sources through slash commands without touching createAgent', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });
    const events: string[] = [];
    codara.subscribeRuntimeEvents((event) => {
      if (event.kind === 'command') {
        events.push(`${event.phase}:${event.status}:${event.label}`);
      }
    });

    const result = await codara.executeCommand('/reload');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS.md');
    expect(events.some((entry) => entry.includes('start:running:Running /reload'))).toBe(true);
    expect(events.some((entry) => entry.includes('end:done:Completed /reload'))).toBe(true);
  });

  it('should expose permission policy files through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-permissions-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const show = await codara.executeCommand('/permissions show');
    expect(show.ok).toBe(true);
    expect(show.output).toContain('Permission policy sources:');
    expect(show.output).toContain(path.join(projectRoot, '.codara', 'settings.local.json'));

    const edit = await codara.executeCommand('/permissions edit');
    expect(edit.action).toEqual({
      type: 'open_file',
      path: path.join(projectRoot, '.codara', 'settings.local.json'),
    });
  });

  it('should clear the current conversation through slash commands', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('one');
    expect(codara.getState().metadata?.messageCount).toBeGreaterThan(0);

    const result = await codara.executeCommand('/clear');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation cleared');
    expect(codara.getState().metadata?.messageCount).toBe(0);
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

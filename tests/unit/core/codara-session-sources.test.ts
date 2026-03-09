import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createCodara} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {SystemEchoModel} from './codara-fixtures';

describe('Codara session source lifecycle', () => {
  it('should keep the same preloaded guidelines and memory for the default session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-sources-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v1', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('project rule v1');
    expect(firstText).toContain('project memory v1');

    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v2', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v2', 'utf8');

    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);
    expect(secondText).toContain('project rule v1');
    expect(secondText).toContain('project memory v1');
    expect(secondText).not.toContain('project rule v2');
    expect(secondText).not.toContain('project memory v2');
  });

  it('should load updated guidelines and memory for a new session host', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-refresh-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v1', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v1', 'utf8');

    const firstCodara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      builtinTools: false,
    });
    await firstCodara.invoke('hello');

    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v2', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v2', 'utf8');

    const secondCodara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      builtinTools: false,
    });
    const result = await secondCodara.invoke('hello');
    const text = String(result.state.messages[result.state.messages.length - 1]?.content);

    expect(text).toContain('project rule v2');
    expect(text).toContain('project memory v2');
    expect(text).not.toContain('project rule v1');
    expect(text).not.toContain('project memory v1');
  });

  it('should reload source projections for the same Codara host when reloadSources is called', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-session-reload-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v1', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v1', 'utf8');

    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      cwd: nestedCwd,
      threadId: 'reload-sources-thread',
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      builtinTools: false,
    });

    const first = await codara.invoke('hello');
    const firstText = String(first.state.messages[first.state.messages.length - 1]?.content);
    expect(firstText).toContain('project rule v1');
    expect(firstText).toContain('project memory v1');

    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule v2', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory v2', 'utf8');

    await codara.reloadSources();
    const second = await codara.invoke('again');
    const secondText = String(second.state.messages[second.state.messages.length - 1]?.content);

    expect(secondText).toContain('project rule v2');
    expect(secondText).toContain('project memory v2');
    expect(secondText).not.toContain('project rule v1');
    expect(secondText).not.toContain('project memory v1');
  });
});

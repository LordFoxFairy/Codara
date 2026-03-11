import {describe, expect, it} from 'bun:test';
import {access, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createCodara} from '@core';
import {EchoModel} from './codara-fixtures';

describe('Codara memory command', () => {
  it('should show the current AGENTS.md memory stack through /memory show', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-command-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const packageRoot = path.join(projectRoot, 'packages');
    const cwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const rootFile = path.join(projectRoot, 'AGENTS.md');
    const packageFile = path.join(packageRoot, 'AGENTS.md');
    const projectFile = path.join(cwd, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(cwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'package.json'), '{}\n', 'utf8');
    await writeFile(globalFile, '# Global Rules\n', 'utf8');
    await writeFile(rootFile, '# Root Rules\n', 'utf8');
    await writeFile(packageFile, '# Package Rules\n', 'utf8');
    await writeFile(projectFile, '# App Rules\n', 'utf8');

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      userHome,
      cwd,
    });

    const result = await codara.executeCommand('/memory show');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS source stack:');
    expect(result.output).toContain(globalFile);
    expect(result.output).toContain(rootFile);
    expect(result.output).toContain(packageFile);
    expect(result.output).toContain(projectFile);
    expect(result.output).toContain('(loaded)');
    expect(result.output).toContain('Edit targets:');
  });

  it('should prepare the project AGENTS.md target through /memory project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-command-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const cwd = path.join(projectRoot, 'packages', 'app');
    const projectFile = path.join(cwd, 'AGENTS.md');

    await mkdir(cwd, {recursive: true});

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      userHome,
      cwd,
    });

    const result = await codara.executeCommand('/memory project');

    expect(result.ok).toBe(true);
    expect(result.action).toEqual({
      type: 'open_file',
      path: projectFile,
    });
    expect(result.output).toContain(projectFile);
    expect(result.output).toContain('/memory global');
    await access(projectFile);
    expect(await readFile(projectFile, 'utf8')).toBe('');
  });

  it('should prepare the global AGENTS.md target through /memory global', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-command-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');

    await mkdir(projectRoot, {recursive: true});

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      userHome,
      projectRoot,
    });

    const result = await codara.executeCommand('/memory global');

    expect(result.ok).toBe(true);
    expect(result.action).toEqual({
      type: 'open_file',
      path: globalFile,
    });
    expect(result.output).toContain(globalFile);
    expect(result.output).toContain('/memory project');
    await access(globalFile);
  });

  it('should default /memory to showing the available AGENTS.md memory targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-command-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const cwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(cwd, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(cwd, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n', 'utf8');
    await writeFile(projectFile, '# App Rules\n', 'utf8');

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      userHome,
      cwd,
    });

    const result = await codara.executeCommand('/memory');

    expect(result.ok).toBe(true);
    expect(result.action).toBeUndefined();
    expect(result.output).toContain(globalFile);
    expect(result.output).toContain(projectFile);
    expect(result.output).toContain('/memory project');
  });
});

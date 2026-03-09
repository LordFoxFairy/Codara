import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createMemoryMiddleware} from '@core/middleware/memory';
import {createCodaraSourceProvider} from '@core/sessions/source-provider';
import type {BeforeModelContext} from '@core/middleware';

describe('MEMORY module', () => {
  it('should load project memory when it exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'MEMORY.md');
    const projectFile = path.join(projectRoot, '.codara', 'MEMORY.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(globalFile, '# Team Preferences\n\nPrefer concise PR descriptions.\n', 'utf8');
    await writeFile(projectFile, '# Project Facts\n\nThe API uses cursor pagination.\nPrefer UTC timestamps.\n', 'utf8');

    const sourceProvider = createCodaraSourceProvider({userHome, projectRoot});
    const content = await sourceProvider.get('memory');

    expect(content).toBeDefined();
    // Should load project memory (priority over global)
    expect(content).toContain('# Project Facts');
    expect(content).toContain('The API uses cursor pagination.');
    expect(content).toContain('# Team Preferences');
  });

  it('should resolve project memory from the workspace root derived from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'MEMORY.md');
    const projectFile = path.join(projectRoot, '.codara', 'MEMORY.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(path.dirname(projectFile), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(globalFile, '# Global Memory\n\nUse UTC timestamps.\n', 'utf8');
    await writeFile(projectFile, '# Project Memory\n\nAPI uses cursor pagination.\n', 'utf8');

    const sourceProvider = createCodaraSourceProvider({userHome, cwd: nestedCwd});
    const content = await sourceProvider.get('memory');

    expect(content).toBeDefined();
    expect(content).toContain('# Global Memory');
    expect(content).toContain('# Project Memory');
  });

  it('should fall back to global memory when project memory does not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'MEMORY.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(globalFile, '# Global Memory\n\nUse UTC timestamps.\n', 'utf8');

    const sourceProvider = createCodaraSourceProvider({userHome, projectRoot});
    const content = await sourceProvider.get('memory');

    expect(content).toBeDefined();
    expect(content).toContain('# Global Memory');
    expect(content).not.toContain('## Project MEMORY.md');
  });

  it('should inject preloaded memory content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const projectFile = path.join(projectRoot, '.codara', 'MEMORY.md');

    await mkdir(path.dirname(projectFile), {recursive: true});
    await writeFile(projectFile, '# Original memory.\n', 'utf8');

    const sourceProvider = createCodaraSourceProvider({userHome, projectRoot});
    const middleware = createMemoryMiddleware(sourceProvider);
    const context: BeforeModelContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, agentContext: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    await middleware.beforeModel?.(context);
    expect(context.systemMessage[1]).toContain('Original memory.');
  });
});

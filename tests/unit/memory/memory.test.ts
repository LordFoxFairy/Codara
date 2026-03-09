import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {loadMemory} from '@core/middleware/memory';
import {createMemoryMiddleware} from '@core/middleware/memory';
import type {BeforeModelContext} from '@core/middleware';

describe('MEMORY module', () => {
  it('should load memory as a compact snapshot instead of the full file body', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'MEMORY.md');
    const projectFile = path.join(projectRoot, '.codara', 'MEMORY.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(globalFile, '# Team Preferences\n\nPrefer concise PR descriptions.\n', 'utf8');
    await writeFile(projectFile, '# Project Facts\n\nThe API uses cursor pagination.\nPrefer UTC timestamps.\n', 'utf8');

    const loaded = await loadMemory({userHome, projectRoot});
    expect(loaded).toBeDefined();
    expect(loaded?.files.map((file) => file.scope)).toEqual(['global', 'project']);
    expect(loaded?.content).toContain('# Project Memory');
    expect(loaded?.content).toContain(`Path: ${globalFile}`);
    expect(loaded?.content).toContain(`Path: ${projectFile}`);
    expect(loaded?.content).toContain('# Team Preferences');
    expect(loaded?.content).toContain('# Project Facts');
    expect(loaded?.content).toContain('Prefer concise PR descriptions.');
    expect(loaded?.content).toContain('The API uses cursor pagination.');
    expect(loaded?.content).toContain('Read the source files directly if more detail is required.');
  });

  it('should resolve global and project memory from the workspace root derived from cwd', async () => {
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

    const loaded = await loadMemory({userHome, cwd: nestedCwd});

    expect(loaded?.files).toEqual([
      {scope: 'global', path: globalFile},
      {scope: 'project', path: projectFile},
    ]);
  });

  it('should inject preloaded memory content', async () => {
    const middleware = createMemoryMiddleware('# Project Memory\n\nOriginal memory.\n');
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

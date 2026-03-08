import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage} from '@langchain/core/messages';
import {
  createGuidelinesMiddleware,
  loadGuidelines,
} from '@core/middleware/guidelines';
import type {ModelCallContext} from '@core/middleware';

describe('AGENTS guidelines', () => {
  it('should resolve global and project AGENTS.md locations from cwd up to the workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');
    const packageFile = path.join(projectRoot, 'packages', 'AGENTS.md');
    const appFile = path.join(nestedCwd, 'AGENTS.md');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n\nKeep commits small.\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n\nRun tests before merge.\n', 'utf8');
    await writeFile(packageFile, '# Package Rules\n\nUse package lint first.\n', 'utf8');
    await writeFile(appFile, '# App Rules\n\nPrefer feature flags.\n', 'utf8');

    const loaded = await loadGuidelines({userHome, cwd: nestedCwd});

    expect(loaded?.files).toEqual([
      {scope: 'global', path: globalFile},
      {scope: 'project', path: projectFile},
      {scope: 'project', path: packageFile},
      {scope: 'project', path: appFile},
    ]);
  });

  it('should load guidelines as a compact snapshot instead of the full file body', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n\nKeep commits small.\nUse Chinese comments when helpful.\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n\nUse pnpm only.\nRun tests before merge.\n', 'utf8');

    const loaded = await loadGuidelines({userHome, projectRoot});
    expect(loaded).toBeDefined();
    expect(loaded?.files.map((file) => file.scope)).toEqual(['global', 'project']);
    expect(loaded?.content).toContain('# AGENTS Guidelines');
    expect(loaded?.content).toContain(`Path: ${globalFile}`);
    expect(loaded?.content).toContain(`Path: ${projectFile}`);
    expect(loaded?.content).toContain('# Global Rules');
    expect(loaded?.content).toContain('# Project Rules');
    expect(loaded?.content).toContain('Keep commits small.');
    expect(loaded?.content).toContain('Run tests before merge.');
    expect(loaded?.content).toContain('Read the source files directly if more detail is required.');
  });

  it('should inject preloaded guideline content', async () => {
    const middleware = createGuidelinesMiddleware('# AGENTS Guidelines\n\nOriginal rule.\n');
    const context: ModelCallContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}, agentContext: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    const first = await middleware.wrapModelCall?.(context, async (request) => {
      expect(request?.systemMessage[1]).toContain('Original rule.');
      return new AIMessage('ok');
    });
    expect(first?.content).toBe('ok');
  });

  it('should preserve root-to-cwd guideline order in loaded files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');
    const packageFile = path.join(projectRoot, 'packages', 'AGENTS.md');
    const appFile = path.join(nestedCwd, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(globalFile, '# Global Rules\n', 'utf8');
    await writeFile(projectFile, '# Project Rules\n', 'utf8');
    await writeFile(packageFile, '# Package Rules\n', 'utf8');
    await writeFile(appFile, '# App Rules\n', 'utf8');

    const loaded = await loadGuidelines({userHome, cwd: nestedCwd});
    expect(loaded).toBeDefined();

    expect(loaded?.files).toEqual([
      {scope: 'global', path: globalFile},
      {scope: 'project', path: projectFile},
      {scope: 'project', path: packageFile},
      {scope: 'project', path: appFile},
    ]);
  });
});

import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage} from '@langchain/core/messages';
import {
  createGuidelinesMiddleware,
  createGuidelinesStore,
  discoverGuidelineFiles,
  loadGuidelines,
} from '@core/middleware/guidelines';
import type {ModelCallContext} from '@core/middleware';

describe('AGENTS guidelines', () => {
  it('should discover global and project AGENTS.md locations in order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(projectRoot, {recursive: true});

    const files = discoverGuidelineFiles({userHome, projectRoot});

    expect(files).toEqual([
      {
        scope: 'global',
        path: path.join(userHome, '.codara', 'AGENTS.md'),
      },
      {
        scope: 'project',
        path: path.join(projectRoot, 'AGENTS.md'),
      },
    ]);
  });

  it('should resolve the nearest workspace root from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});

    const files = discoverGuidelineFiles({userHome, cwd: nestedCwd});

    expect(files).toEqual([
      {
        scope: 'global',
        path: path.join(userHome, '.codara', 'AGENTS.md'),
      },
      {
        scope: 'project',
        path: path.join(projectRoot, 'AGENTS.md'),
      },
    ]);
  });

  it('should load global and project AGENTS.md without caching', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'AGENTS.md');
    const projectFile = path.join(projectRoot, 'AGENTS.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(globalFile, 'global rule', 'utf8');
    await writeFile(projectFile, 'project rule', 'utf8');

    const loaded = await loadGuidelines({userHome, projectRoot});
    expect(loaded).toBeDefined();
    expect(loaded?.files.map((file) => file.scope)).toEqual(['global', 'project']);
    expect(loaded?.content).toContain('## Global AGENTS.md');
    expect(loaded?.content).toContain('global rule');
    expect(loaded?.content).toContain('## Project AGENTS.md');
    expect(loaded?.content).toContain('project rule');

    await writeFile(projectFile, 'project rule updated', 'utf8');
    const reloaded = await loadGuidelines({userHome, projectRoot});
    expect(reloaded?.content).toContain('project rule updated');
  });

  it('should inject AGENTS.md content into system messages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(userHome, '.codara', 'AGENTS.md'), 'global rule', 'utf8');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule', 'utf8');

    const guidelinesStore = createGuidelinesStore({userHome, projectRoot});
    const middleware = createGuidelinesMiddleware();
    const context: ModelCallContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {__codaraGuidelines: guidelinesStore}, agentContext: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    const response = await middleware.wrapModelCall?.(context, async (request) => {
      expect(request?.systemMessage).toHaveLength(2);
      expect(request?.systemMessage[0]).toBe('base system');
      expect(request?.systemMessage[1]).toContain('global rule');
      expect(request?.systemMessage[1]).toContain('project rule');
      return new AIMessage('ok');
    });

    expect(response?.content).toBe('ok');
  });
});

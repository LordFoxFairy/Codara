import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage} from '@langchain/core/messages';
import {
  createMemoryEditor,
  createMemoryMiddleware,
  createMemoryStore,
  discoverMemoryFiles,
  loadMemory,
} from '@core/memory';
import type {ModelCallContext} from '@core/middleware';

describe('MEMORY module', () => {
  it('should discover global and project MEMORY.md locations in order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(projectRoot, {recursive: true});

    const files = discoverMemoryFiles({userHome, projectRoot});

    expect(files).toEqual([
      {
        scope: 'global',
        path: path.join(userHome, '.codara', 'MEMORY.md'),
      },
      {
        scope: 'project',
        path: path.join(projectRoot, 'MEMORY.md'),
      },
    ]);
  });

  it('should resolve the nearest workspace root from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});

    const files = discoverMemoryFiles({userHome, cwd: nestedCwd});

    expect(files).toEqual([
      {
        scope: 'global',
        path: path.join(userHome, '.codara', 'MEMORY.md'),
      },
      {
        scope: 'project',
        path: path.join(projectRoot, 'MEMORY.md'),
      },
    ]);
  });

  it('should load global and project MEMORY.md without caching', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const globalFile = path.join(userHome, '.codara', 'MEMORY.md');
    const projectFile = path.join(projectRoot, 'MEMORY.md');

    await mkdir(path.dirname(globalFile), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(globalFile, 'global memory', 'utf8');
    await writeFile(projectFile, 'project memory', 'utf8');

    const loaded = await loadMemory({userHome, projectRoot});
    expect(loaded).toBeDefined();
    expect(loaded?.files.map((file) => file.scope)).toEqual(['global', 'project']);
    expect(loaded?.content).toContain('## Global MEMORY.md');
    expect(loaded?.content).toContain('global memory');
    expect(loaded?.content).toContain('## Project MEMORY.md');
    expect(loaded?.content).toContain('project memory');

    await writeFile(projectFile, 'project memory updated', 'utf8');
    const reloaded = await loadMemory({userHome, projectRoot});
    expect(reloaded?.content).toContain('project memory updated');
  });

  it('should inject MEMORY.md content into system messages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(userHome, '.codara', 'MEMORY.md'), 'global memory', 'utf8');
    await writeFile(path.join(projectRoot, 'MEMORY.md'), 'project memory', 'utf8');

    const middleware = createMemoryMiddleware({userHome, projectRoot});
    const context: ModelCallContext = {
      state: {messages: []},
      messages: [],
      runtime: {context: {}},
      systemMessage: ['base system'],
      runId: 'run_1',
      turn: 1,
      maxTurns: 8,
      requestId: 'req_1',
    };

    const response = await middleware.wrapModelCall?.(context, async (request) => {
      expect(request?.systemMessage).toHaveLength(2);
      expect(request?.systemMessage[0]).toBe('base system');
      expect(request?.systemMessage[1]).toContain('global memory');
      expect(request?.systemMessage[1]).toContain('project memory');
      return new AIMessage('ok');
    });

    expect(response?.content).toBe('ok');
  });

  it('should truncate oversized memory content by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(projectRoot, 'MEMORY.md'), 'a'.repeat(12_500), 'utf8');

    const loaded = await loadMemory({projectRoot});
    expect(loaded).toBeDefined();
    expect(loaded?.content).toContain('[truncated]');
  });

  it('should respect a custom maxChars limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(projectRoot, 'MEMORY.md'), 'abcdefghijklmno', 'utf8');

    const loaded = await loadMemory({projectRoot, maxChars: 5});
    expect(loaded).toBeDefined();
    expect(loaded?.content).toContain('abcde');
    expect(loaded?.content).toContain('[truncated]');
  });

  it('should provide a minimal read write store for global and project memory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const store = createMemoryStore({userHome, projectRoot});

    await store.write('global', 'global memory body');
    await store.write('project', 'project memory body');

    expect(store.resolve('global')).toBe(path.join(userHome, '.codara', 'MEMORY.md'));
    expect(store.resolve('project')).toBe(path.join(projectRoot, 'MEMORY.md'));
    expect(await store.exists('global')).toBe(true);
    expect(await store.exists('project')).toBe(true);
    expect(await store.read('global')).toBe('global memory body');
    expect(await store.read('project')).toBe('project memory body');

    await store.delete('project');
    expect(await store.exists('project')).toBe(false);
  });

  it('should let the store resolve project memory against the workspace root from cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});

    const store = createMemoryStore({cwd: nestedCwd});

    await store.write('project', 'workspace memory');

    expect(store.resolve('project')).toBe(path.join(projectRoot, 'MEMORY.md'));
    expect(await store.read('project')).toBe('workspace memory');
  });

  it('should append managed memory sections without overwriting manual content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(projectRoot, 'MEMORY.md'), '# Team Notes\n\nKeep this file tidy.', 'utf8');

    const editor = createMemoryEditor({projectRoot});

    await editor.remember('project', {
      kind: 'fact',
      content: 'The API uses cursor pagination.',
    });

    const store = createMemoryStore({projectRoot});
    const content = await store.read('project');

    expect(content).toContain('# Team Notes');
    expect(content).toContain('Keep this file tidy.');
    expect(content).toContain('## Codara Memory');
    expect(content).toContain('### Facts');
    expect(content).toContain('- The API uses cursor pagination.');
  });

  it('should deduplicate memory entries within the same section', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});

    const editor = createMemoryEditor({projectRoot});

    const first = await editor.remember('project', {
      kind: 'lesson',
      content: 'Run lint before opening a PR.',
    });
    const second = await editor.remember('project', {
      kind: 'lesson',
      content: 'Run lint before opening a PR.',
    });

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);

    const store = createMemoryStore({projectRoot});
    const content = await store.read('project');
    expect(content).toContain('### Lessons');
    expect(content?.match(/- Run lint before opening a PR\./g)?.length).toBe(1);
  });

  it('should keep separate sections for different memory kinds', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const userHome = path.join(root, 'home');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});

    const editor = createMemoryEditor({userHome});

    await editor.remember('global', {
      kind: 'preference',
      content: 'Prefer concise changelog entries.',
    });
    await editor.remember('global', {
      kind: 'fact',
      content: 'The production cluster runs in ap-southeast-1.',
    });

    const store = createMemoryStore({userHome});
    const content = await store.read('global');

    expect(content).toContain('### Preferences');
    expect(content).toContain('- Prefer concise changelog entries.');
    expect(content).toContain('### Facts');
    expect(content).toContain('- The production cluster runs in ap-southeast-1.');
  });

  it('should expose a structured snapshot of managed memory entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});
    const editor = createMemoryEditor({projectRoot});

    await editor.remember('project', {
      kind: 'preference',
      content: 'Prefer small PRs.',
    });
    await editor.remember('project', {
      kind: 'fact',
      content: 'The service uses UTC timestamps.',
    });

    const snapshot = await editor.snapshot('project');

    expect(snapshot).toEqual({
      preference: ['Prefer small PRs.'],
      fact: ['The service uses UTC timestamps.'],
      lesson: [],
    });
  });

  it('should remove a managed memory entry without touching manual content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-memory-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(projectRoot, {recursive: true});
    await writeFile(path.join(projectRoot, 'MEMORY.md'), '# Notes\n\nManual paragraph.', 'utf8');

    const editor = createMemoryEditor({projectRoot});
    await editor.remember('project', {
      kind: 'lesson',
      content: 'Run lint before opening a PR.',
    });

    const removed = await editor.forget('project', {
      kind: 'lesson',
      content: 'Run lint before opening a PR.',
    });

    expect(removed.entries.lesson).toEqual([]);

    const store = createMemoryStore({projectRoot});
    const content = await store.read('project');
    expect(content).toContain('# Notes');
    expect(content).toContain('Manual paragraph.');
    expect(content).not.toContain('- Run lint before opening a PR.');
  });
});

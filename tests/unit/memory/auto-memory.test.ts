import {describe, expect, it} from 'bun:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {AIMessage, HumanMessage} from '@langchain/core/messages';
import {
  createAutoMemoryRuntime,
  resolveAutoMemoryRoot,
  shouldRecordAutoMemoryTurn,
} from '@core/memory/auto-memory';

describe('auto memory runtime', () => {
  it('resolves the memory root globally by default and lets project settings override user settings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-root-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const projectSettingsDir = path.join(projectRoot, '.codara');
    const userSettingsDir = path.join(userHome, '.codara');

    await mkdir(projectSettingsDir, {recursive: true});
    await mkdir(userSettingsDir, {recursive: true});

    const defaultRoot = resolveAutoMemoryRoot({projectRoot, userHome});
    expect(defaultRoot).toContain(path.join(userHome, '.codara', 'projects'));
    expect(defaultRoot.endsWith(path.join('memory'))).toBe(true);

    await writeFile(path.join(userSettingsDir, 'settings.json'), JSON.stringify({memory: {autoGlobal: false}}), 'utf8');
    await writeFile(path.join(projectSettingsDir, 'settings.json'), JSON.stringify({memory: {autoGlobal: true}}), 'utf8');
    expect(resolveAutoMemoryRoot({projectRoot, userHome})).toBe(defaultRoot);

    await writeFile(path.join(projectSettingsDir, 'settings.json'), JSON.stringify({memory: {autoGlobal: false}}), 'utf8');
    expect(resolveAutoMemoryRoot({projectRoot, userHome})).toBe(path.join(projectRoot, '.codara', 'memory'));
  });

  it('loads only the first 200 lines of MEMORY.md into the instruction context', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-index-'));
    const lines = Array.from({length: 220}, (_, index) => `line ${index + 1}`).join('\n');
    await writeFile(path.join(rootDir, 'MEMORY.md'), `${lines}\n`, 'utf8');

    const runtime = createAutoMemoryRuntime({rootDir});
    const content = await runtime.source.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('line 1');
    expect(content).toContain('line 200');
    expect(content).not.toContain('line 220');
    expect(content).toContain('Truncated after 200 lines');
  });

  it('writes topic files and regenerates the MEMORY.md index after a successful turn', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-write-'));
    const runtime = createAutoMemoryRuntime({rootDir});

    const recorded = await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('Fix lint errors in src/app.ts'),
        new AIMessage('Updated the lint config and fixed the failing import order check.'),
      ],
      sessionId: 'session-auto-memory',
    });

    expect(recorded).toBe(true);
    expect(existsSync(path.join(rootDir, 'MEMORY.md'))).toBe(true);

    const index = await readFile(path.join(rootDir, 'MEMORY.md'), 'utf8');
    expect(index).toContain('# Auto Memory');
    expect(index).toContain('Fix lint errors in src/app.ts');

    const topicsDir = path.join(rootDir, 'topics');
    const topics = await readdir(topicsDir);
    expect(topics.length).toBe(1);

    const topicContent = await readFile(path.join(topicsDir, topics[0]), 'utf8');
    expect(topicContent).toContain('## Prompt');
    expect(topicContent).toContain('Fix lint errors in src/app.ts');
    expect(topicContent).toContain('## Outcome');
  });

  it('skips persistence for non-main, paused, or failed turns', async () => {
    expect(shouldRecordAutoMemoryTurn({
      reason: 'complete',
      state: {agentType: 'main', pendingPause: undefined},
    } as never)).toBe(true);

    expect(shouldRecordAutoMemoryTurn({
      reason: 'error',
      state: {agentType: 'main', pendingPause: undefined},
    } as never)).toBe(false);

    expect(shouldRecordAutoMemoryTurn({
      reason: 'complete',
      state: {agentType: 'main', pendingPause: {id: 'pause'}},
    } as never)).toBe(false);

    expect(shouldRecordAutoMemoryTurn({
      reason: 'complete',
      state: {agentType: 'subagent', pendingPause: undefined},
    } as never)).toBe(false);
  });
});

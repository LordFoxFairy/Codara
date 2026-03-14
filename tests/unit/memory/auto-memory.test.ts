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
} from '@core/context/memory/auto-memory';

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
    expect(topicContent).toContain('fingerprint:');
    expect(topicContent).toContain('area: general');
    expect(index).toContain('Updated ');
  });

  it('merges repeated similar memories into the same topic file', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-merge-'));
    const runtime = createAutoMemoryRuntime({rootDir});

    await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('Document the lint workflow for src/app.ts'),
        new AIMessage({
          content: 'Explained the lint workflow and updated src/app.ts conventions.',
          tool_calls: [{id: 'call_1', name: 'read_file', args: {file_path: 'src/app.ts'}}],
        }),
      ],
      sessionId: 'session-one',
    });

    await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('Document the lint workflow for src/app.ts'),
        new AIMessage({
          content: 'Expanded the guidance with the final import-order expectations.',
          tool_calls: [{id: 'call_2', name: 'read_file', args: {file_path: 'src/app.ts'}}],
        }),
      ],
      sessionId: 'session-two',
    });

    const topicsDir = path.join(rootDir, 'topics');
    const topics = await readdir(topicsDir);
    expect(topics.length).toBe(1);

    const topicContent = await readFile(path.join(topicsDir, topics[0]), 'utf8');
    expect(topicContent).toContain('Expanded the guidance with the final import-order expectations.');
    expect(topicContent).toContain('## Earlier Notes');
    expect(topicContent).toContain('Explained the lint workflow and updated src/app.ts conventions.');
    const index = await readFile(path.join(rootDir, 'MEMORY.md'), 'utf8');
    expect(index).toContain('## Active Areas');
    expect(index).toContain('- src: 1 topic');
  });

  it('merges different prompts that work on the same area into one topic cluster', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-area-'));
    const runtime = createAutoMemoryRuntime({rootDir});

    await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('Investigate the refund workflow'),
        new AIMessage({
          content: 'Reviewed the refund edge cases in payments.',
          tool_calls: [{id: 'call_1', name: 'read_file', args: {file_path: 'src/payments/refund.ts'}}],
        }),
      ],
      sessionId: 'session-payments-1',
    });

    await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('Update chargeback handling'),
        new AIMessage({
          content: 'Adjusted the chargeback notes in the same payments area.',
          tool_calls: [{id: 'call_2', name: 'read_file', args: {file_path: 'src/payments/chargeback.ts'}}],
        }),
      ],
      sessionId: 'session-payments-2',
    });

    const topicsDir = path.join(rootDir, 'topics');
    const topics = await readdir(topicsDir);
    expect(topics.length).toBe(1);

    const topicContent = await readFile(path.join(topicsDir, topics[0]), 'utf8');
    expect(topicContent).toContain('area: src/payments');
    expect(topicContent).toContain('src/payments/refund.ts');
    expect(topicContent).toContain('src/payments/chargeback.ts');
  });

  it('skips low-signal successful turns that do not produce meaningful memory', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-auto-memory-low-signal-'));
    const runtime = createAutoMemoryRuntime({rootDir});

    const recorded = await runtime.recordTurn({
      previousMessages: [],
      nextMessages: [
        new HumanMessage('thanks'),
        new AIMessage('Done.'),
      ],
      sessionId: 'session-low-signal',
    });

    expect(recorded).toBe(false);
    expect(existsSync(path.join(rootDir, 'MEMORY.md'))).toBe(false);
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

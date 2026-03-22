import * as fs from 'node:fs';
import {mkdtemp, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it, spyOn} from 'bun:test';
import {createAgentRunFileStore} from '@capability/subagent';

describe('agent run file store', () => {
  it('persists delegated runs to disk and reloads them', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-agent-run-file-store-'));
    const store = createAgentRunFileStore({rootDir});

    store.start({
      runId: 'run-1',
      parentSessionId: 'session-1',
      label: 'Delegating research: inspect auth flow',
      agentName: 'research',
    });
    store.update('run-1', {
      latestActivity: 'read_file(src/auth.ts)',
    });
    store.finish('run-1', {
      type: 'delegated_agent_result',
      sessionId: 'child-1',
      turns: 2,
      reason: 'complete',
      summary: 'found the auth entrypoint',
      toolUseCount: 3,
      totalTokens: 120,
    });

    const files = await readdir(rootDir);
    expect(files).toContain('run-1.json');

    const reopened = createAgentRunFileStore({rootDir});
    expect(reopened.get('run-1')).toEqual(expect.objectContaining({
      runId: 'run-1',
      parentSessionId: 'session-1',
      status: 'completed',
      childSessionId: 'child-1',
      summary: 'found the auth entrypoint',
      latestActivity: 'read_file(src/auth.ts)',
    }));
    const persisted = JSON.parse(await Bun.file(path.join(rootDir, 'run-1.json')).text()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('prompt');
    expect(persisted).not.toHaveProperty('maxTurns');
    expect(persisted).not.toHaveProperty('toolNames');
    expect(persisted).not.toHaveProperty('systemMessages');
    expect(persisted).not.toHaveProperty('recovery');
  });

  it('keeps task runs in memory after the first load instead of re-reading the directory on every list', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-agent-run-cache-'));
    const readdirSpy = spyOn(fs, 'readdirSync');
    const readFileSpy = spyOn(fs, 'readFileSync');

    try {
      const store = createAgentRunFileStore({rootDir});

      store.start({
        runId: 'run-cache',
        parentSessionId: 'session-cache',
        label: 'Delegating research: inspect auth flow',
        agentName: 'research',
      });

      expect(store.list()).toHaveLength(1);
      expect(store.list()).toHaveLength(1);

      expect(readdirSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledTimes(0);
    } finally {
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }
  });
});

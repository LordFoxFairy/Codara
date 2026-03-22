import {describe, expect, it} from 'bun:test';
import {createAgentRunMemoryStore} from '@capability/subagent';

describe('agent run store', () => {
  it('tracks start, activity, and completion for delegated runs', () => {
    const store = createAgentRunMemoryStore();

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

    expect(store.list()).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        parentSessionId: 'session-1',
        status: 'completed',
        childSessionId: 'child-1',
        latestActivity: 'read_file(src/auth.ts)',
        summary: 'found the auth entrypoint',
        toolUseCount: 3,
        totalTokens: 120,
        endedAt: expect.any(String),
      }),
    ]);
  });

  it('persists live tool counts while a delegated run is still active', () => {
    const store = createAgentRunMemoryStore();

    store.start({
      runId: 'run-live-count',
      parentSessionId: 'session-1',
      label: 'Delegating research: inspect auth flow',
      agentName: 'research',
    });
    store.update('run-live-count', {
      latestActivity: 'read_file(src/auth.ts)',
      toolUseCount: 1,
    } as never);
    store.update('run-live-count', {
      latestActivity: 'glob(src/**/*)',
      toolUseCount: 2,
    } as never);

    expect(store.get('run-live-count')).toEqual(expect.objectContaining({
      runId: 'run-live-count',
      status: 'running',
      latestActivity: 'glob(src/**/*)',
      toolUseCount: 2,
    }));
  });

  it('marks paused runs without replacing the original start time', () => {
    const store = createAgentRunMemoryStore();

    const started = store.start({
      runId: 'run-2',
      parentSessionId: 'session-2',
      label: 'Delegating plan',
      agentName: 'Plan',
    });
    const paused = store.pause('run-2', {
      childSessionId: 'child-2',
      latestActivity: 'Waiting for review',
    });

    expect(paused).toEqual(expect.objectContaining({
      runId: 'run-2',
      parentSessionId: 'session-2',
      status: 'paused',
      childSessionId: 'child-2',
      latestActivity: 'Waiting for review',
      startedAt: started.startedAt,
      endedAt: undefined,
    }));
  });
});

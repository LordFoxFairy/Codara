import {describe, expect, it} from 'bun:test';
import {
  deriveActiveTaskSnapshot,
  deriveActiveTasks,
  extractTaskName,
  type AgentRunQuerySummary,
} from '../../../src/cli/hooks/use-active-tasks';

function createTaskRun(overrides: Partial<AgentRunQuerySummary>): AgentRunQuerySummary {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    label: 'Delegating task',
    agentName: 'Agent',
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('extractTaskName', () => {
  it('extracts subagent type and prompt', () => {
    expect(extractTaskName('Delegating research: find API docs')).toBe('research: find API docs');
  });

  it('extracts subagent type alone', () => {
    expect(extractTaskName('Delegating research')).toBe('research');
  });

  it('truncates long names to 40 chars', () => {
    const long = 'Delegating research: ' + 'a'.repeat(50);
    expect(extractTaskName(long).length).toBeLessThanOrEqual(40);
  });

  it('falls back to raw label', () => {
    expect(extractTaskName('some random label')).toBe('some random label');
  });

  it('extracts a concise first clause from verbose Chinese delegation labels', () => {
    expect(
      extractTaskName('Delegating Explore: 分析当前项目是做什么的。请执行以下只读检查：README、package.json、src 目录结构'),
    ).toBe('Explore: 分析当前项目是做什么的');
  });
});

describe('deriveActiveTasks', () => {
  const baseTime = Date.parse('2026-03-16T00:00:00Z');

  it('returns running task from stable run summary', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating research: find docs',
        latestActivity: 'read_file(src/auth.ts)',
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 5000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('running');
    expect(tasks[0]!.name).toBe('research: find docs');
    expect(tasks[0]!.elapsed).toBe(5000);
    expect(tasks[0]!.detail).toBe('read_file(src/auth.ts)');
  });

  it('surfaces live tool counts from running task summaries', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating Explore: 分析当前项目是做什么的。请执行以下只读检查：README、package.json、src 目录结构',
        latestActivity: 'glob(src/**/*)',
        toolUseCount: 3,
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 5000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.name).toBe('Explore: 分析当前项目是做什么的');
    expect(tasks[0]!.toolUseCount).toBe(3);
  });

  it('keeps a lone completed task visible until a later batch starts', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating research',
        status: 'completed',
        endedAt: new Date(baseTime + 3000).toISOString(),
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 4000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('done');
  });

  it('replaces the previous completed batch when a new batch starts', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-old',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating research',
        status: 'completed',
        endedAt: new Date(baseTime + 1000).toISOString(),
      }),
      createTaskRun({
        runId: 'task-new',
        startedAt: new Date(baseTime + 5000).toISOString(),
        label: 'Delegating build',
        status: 'running',
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 6000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('task-new');
    expect(tasks[0]!.status).toBe('running');
  });

  it('keeps completed tasks visible while sibling tasks are still running or paused', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-done',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating Explore: Analyze architecture',
        status: 'completed',
        endedAt: new Date(baseTime + 4000).toISOString(),
      }),
      createTaskRun({
        runId: 'task-running',
        startedAt: new Date(baseTime + 2000).toISOString(),
        label: 'Delegating Explore: Analyze tech stack',
        status: 'running',
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 18000);
    expect(tasks).toHaveLength(2);
    expect(tasks.some((task) => task.id === 'task-done' && task.status === 'done')).toBe(true);
    expect(tasks.some((task) => task.id === 'task-running' && task.status === 'running')).toBe(true);
  });

  it('keeps a lone failed task visible until a later batch starts', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating build',
        status: 'failed',
        endedAt: new Date(baseTime + 500).toISOString(),
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 1000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('error');
  });

  it('keeps approval-waiting task runs visible as paused tasks', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-paused',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating approval: unsafe write',
        status: 'paused',
        latestActivity: 'Waiting for approval on dangerous_tool',
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 4000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('paused');
    expect(tasks[0]!.detail).toBe('Waiting for approval on dangerous_tool');
  });

  it('sorts running tasks before completed tasks', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-done',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating research',
        status: 'completed',
        endedAt: new Date(baseTime + 4000).toISOString(),
      }),
      createTaskRun({
        runId: 'task-running',
        startedAt: new Date(baseTime + 2000).toISOString(),
        label: 'Delegating build',
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 3000);
    expect(tasks[0]!.status).toBe('running');
    expect(tasks[1]!.status).toBe('done');
  });

  it('sorts paused approval-waiting tasks after running tasks and before completed tasks', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'task-running',
        startedAt: new Date(baseTime + 2000).toISOString(),
        label: 'Delegating build',
      }),
      createTaskRun({
        runId: 'task-paused',
        startedAt: new Date(baseTime + 1000).toISOString(),
        label: 'Delegating approval: unsafe write',
        status: 'paused',
        latestActivity: 'Waiting for approval on dangerous_tool',
      }),
      createTaskRun({
        runId: 'task-done',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating research',
        status: 'completed',
        endedAt: new Date(baseTime + 4000).toISOString(),
      }),
    ];

    const tasks = deriveActiveTasks(runs, baseTime + 3000);
    expect(tasks.map((task) => task.status)).toEqual(['running', 'paused', 'done']);
  });

  it('limits to 5 visible tasks', () => {
    const runs: AgentRunQuerySummary[] = [];
    for (let i = 0; i < 8; i++) {
      runs.push(createTaskRun({
        runId: `task-${i}`,
        startedAt: new Date(baseTime + i * 100).toISOString(),
        label: `Delegating task-${i}`,
      }));
    }

    const tasks = deriveActiveTasks(runs, baseTime + 10000);
    expect(tasks.length).toBeLessThanOrEqual(5);
  });

  it('counts all matching tasks even when visible rows are capped', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({runId: 'running-1', startedAt: new Date(baseTime + 5000).toISOString(), label: 'Delegating running-1'}),
      createTaskRun({runId: 'running-2', startedAt: new Date(baseTime + 4000).toISOString(), label: 'Delegating running-2'}),
      createTaskRun({runId: 'running-3', startedAt: new Date(baseTime + 3000).toISOString(), label: 'Delegating running-3'}),
      createTaskRun({
        runId: 'done-1',
        startedAt: new Date(baseTime + 2000).toISOString(),
        label: 'Delegating done-1',
        status: 'completed',
        endedAt: new Date(baseTime + 4500).toISOString(),
      }),
      createTaskRun({
        runId: 'done-2',
        startedAt: new Date(baseTime + 1000).toISOString(),
        label: 'Delegating done-2',
        status: 'completed',
        endedAt: new Date(baseTime + 4200).toISOString(),
      }),
      createTaskRun({
        runId: 'error-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating error-1',
        status: 'failed',
        endedAt: new Date(baseTime + 4100).toISOString(),
      }),
    ];

    const snapshot = deriveActiveTaskSnapshot(runs, baseTime + 6000);
    expect(snapshot.tasks).toHaveLength(5);
    expect(snapshot.runningCount).toBe(3);
    expect(snapshot.doneCount).toBe(2);
    expect(snapshot.errorCount).toBe(1);
  });

  it('keeps done-only batches visible in the current batch projection', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'done-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating done-1',
        status: 'completed',
        endedAt: new Date(baseTime + 1000).toISOString(),
      }),
      createTaskRun({
        runId: 'done-2',
        startedAt: new Date(baseTime + 100).toISOString(),
        label: 'Delegating done-2',
        status: 'completed',
        endedAt: new Date(baseTime + 1200).toISOString(),
      }),
    ];

    const snapshot = deriveActiveTaskSnapshot(runs, baseTime + 3000);
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.every((task) => task.status === 'done')).toBe(true);
    expect(snapshot.doneCount).toBe(2);
    expect(snapshot.hiddenCount).toBe(0);
  });

  it('keeps the latest active work in view and reports overflow beyond 5 tasks', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({runId: 'done-1', startedAt: new Date(baseTime).toISOString(), label: 'Delegating done-1', status: 'completed', endedAt: new Date(baseTime + 1000).toISOString()}),
      createTaskRun({runId: 'done-2', startedAt: new Date(baseTime + 100).toISOString(), label: 'Delegating done-2', status: 'completed', endedAt: new Date(baseTime + 1100).toISOString()}),
      createTaskRun({runId: 'done-3', startedAt: new Date(baseTime + 200).toISOString(), label: 'Delegating done-3', status: 'completed', endedAt: new Date(baseTime + 1200).toISOString()}),
      createTaskRun({runId: 'done-4', startedAt: new Date(baseTime + 300).toISOString(), label: 'Delegating done-4', status: 'completed', endedAt: new Date(baseTime + 1300).toISOString()}),
      createTaskRun({runId: 'paused-1', startedAt: new Date(baseTime + 400).toISOString(), label: 'Delegating paused-1', status: 'paused'}),
      createTaskRun({runId: 'running-1', startedAt: new Date(baseTime + 500).toISOString(), label: 'Delegating running-1', status: 'running'}),
    ];

    const snapshot = deriveActiveTaskSnapshot(runs, baseTime + 3000);
    expect(snapshot.tasks).toHaveLength(5);
    expect(snapshot.tasks[0]?.id).toBe('running-1');
    expect(snapshot.tasks[1]?.id).toBe('paused-1');
    expect(snapshot.hiddenCount).toBe(1);
  });

  it('preserves explicitly tracked multi-phase task runs instead of collapsing to only the latest inferred batch', () => {
    const runs: AgentRunQuerySummary[] = [
      createTaskRun({
        runId: 'phase-1-a',
        sessionId: 'session-1',
        startedAt: new Date(baseTime).toISOString(),
        label: 'Delegating Explore: Analyze product scope',
        status: 'completed',
        endedAt: new Date(baseTime + 1000).toISOString(),
      }),
      createTaskRun({
        runId: 'phase-1-b',
        sessionId: 'session-1',
        startedAt: new Date(baseTime + 100).toISOString(),
        label: 'Delegating Explore: Analyze tech stack',
        status: 'completed',
        endedAt: new Date(baseTime + 1100).toISOString(),
      }),
      createTaskRun({
        runId: 'phase-2-a',
        sessionId: 'session-1',
        startedAt: new Date(baseTime + 5000).toISOString(),
        label: 'Delegating Explore: Analyze CLI rendering',
        status: 'running',
      }),
    ];

    const snapshot = deriveActiveTaskSnapshot(
      runs,
      baseTime + 7000,
      [],
      ['phase-1-a', 'phase-1-b', 'phase-2-a'],
    );

    expect(snapshot.tasks.map((task) => task.id)).toEqual(['phase-2-a', 'phase-1-b', 'phase-1-a']);
    expect(snapshot.runningCount).toBe(1);
    expect(snapshot.doneCount).toBe(2);
  });

  it('returns empty list for no task runs', () => {
    expect(deriveActiveTasks([], baseTime)).toHaveLength(0);
  });
});

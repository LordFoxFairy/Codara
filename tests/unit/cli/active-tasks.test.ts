import {describe, expect, it} from 'bun:test';
import type {CodaraRuntimeEvent} from '@/index';
import {deriveActiveTasks, extractTaskName} from '../../../src/cli/hooks/use-active-tasks';

function createEvent(overrides: Partial<CodaraRuntimeEvent>): CodaraRuntimeEvent {
  return {
    id: 'evt-1',
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    kind: 'task',
    phase: 'start',
    status: 'running',
    label: 'Delegating task',
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
});

describe('deriveActiveTasks', () => {
  const baseTime = Date.parse('2026-03-16T00:00:00Z');

  it('returns running task from start event', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({
        id: 'task-1',
        timestamp: new Date(baseTime).toISOString(),
        label: 'Delegating research: find docs',
      }),
    ];

    const tasks = deriveActiveTasks(events, baseTime + 5000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('running');
    expect(tasks[0]!.name).toBe('research: find docs');
    expect(tasks[0]!.elapsed).toBe(5000);
  });

  it('marks task as done when end event arrives', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({
        id: 'task-1',
        timestamp: new Date(baseTime).toISOString(),
        label: 'Delegating research',
      }),
      createEvent({
        id: 'end-1',
        phase: 'end',
        status: 'done',
        timestamp: new Date(baseTime + 3000).toISOString(),
        label: 'Delegated task completed',
        parentId: 'task-1',
      }),
    ];

    const tasks = deriveActiveTasks(events, baseTime + 4000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('done');
    expect(tasks[0]!.elapsed).toBe(3000);
  });

  it('removes done tasks after linger period', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({
        id: 'task-1',
        timestamp: new Date(baseTime).toISOString(),
        label: 'Delegating research',
      }),
      createEvent({
        id: 'end-1',
        phase: 'end',
        status: 'done',
        timestamp: new Date(baseTime + 1000).toISOString(),
        label: 'Delegated task completed',
        parentId: 'task-1',
      }),
    ];

    // Within linger
    expect(deriveActiveTasks(events, baseTime + 2000)).toHaveLength(1);
    // After linger (3 seconds)
    expect(deriveActiveTasks(events, baseTime + 5000)).toHaveLength(0);
  });

  it('marks task as error', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({
        id: 'task-1',
        timestamp: new Date(baseTime).toISOString(),
        label: 'Delegating build',
      }),
      createEvent({
        id: 'end-1',
        phase: 'end',
        status: 'error',
        timestamp: new Date(baseTime + 500).toISOString(),
        label: 'Delegated task failed',
        parentId: 'task-1',
      }),
    ];

    const tasks = deriveActiveTasks(events, baseTime + 1000);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('error');
  });

  it('sorts running tasks before completed tasks', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({
        id: 'task-done',
        timestamp: new Date(baseTime).toISOString(),
        label: 'Delegating research',
      }),
      createEvent({
        id: 'end-done',
        phase: 'end',
        status: 'done',
        timestamp: new Date(baseTime + 1000).toISOString(),
        label: 'done',
        parentId: 'task-done',
      }),
      createEvent({
        id: 'task-running',
        timestamp: new Date(baseTime + 2000).toISOString(),
        label: 'Delegating build',
      }),
    ];

    const tasks = deriveActiveTasks(events, baseTime + 3000);
    expect(tasks[0]!.status).toBe('running');
    expect(tasks[1]!.status).toBe('done');
  });

  it('limits to 5 visible tasks', () => {
    const events: CodaraRuntimeEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(createEvent({
        id: `task-${i}`,
        timestamp: new Date(baseTime + i * 100).toISOString(),
        label: `Delegating task-${i}`,
      }));
    }

    const tasks = deriveActiveTasks(events, baseTime + 10000);
    expect(tasks.length).toBeLessThanOrEqual(5);
  });

  it('ignores non-task events', () => {
    const events: CodaraRuntimeEvent[] = [
      createEvent({id: 'model-1', kind: 'model', label: 'Thinking'}),
      createEvent({id: 'tool-1', kind: 'tool', label: 'Reading file'}),
    ];

    expect(deriveActiveTasks(events, baseTime)).toHaveLength(0);
  });
});

import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {TaskPanel} from '@/cli/components/chrome/task-panel';
import type {ActiveTask} from '@/cli/hooks/use-active-tasks';

describe('TaskPanel', () => {
  it('renders paused approval-waiting tasks with a paused marker', () => {
    const tasks: ActiveTask[] = [
      {
        id: 'task-paused',
        name: 'approval: unsafe write',
        status: 'paused',
        startedAt: Date.parse('2026-03-16T00:00:00Z'),
        elapsed: 2000,
        detail: 'Waiting for approval on dangerous_tool',
      },
    ];

    const {lastFrame} = render(
      <TaskPanel tasks={tasks} runningCount={0} pausedCount={1} doneCount={0} errorCount={0} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('[⏸]');
    expect(frame).toContain('approval: unsafe write');
    expect(frame).toContain('Waiting for approval on dangerous_tool');
  });
});

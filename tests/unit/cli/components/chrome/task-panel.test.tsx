import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {TaskPanel} from '@/cli/components/chrome/task-panel';
import type {ActiveTask} from '@/cli/hooks/use-active-tasks';

function createTask(overrides: Partial<ActiveTask> = {}): ActiveTask {
  return {
    id: 'run-1',
    name: 'Fix all src/ TS + lint errors',
    status: 'running',
    startedAt: Date.parse('2026-03-16T00:00:00Z'),
    elapsed: 4200,
    detail: 'Update: src/gateway/session-manager.ts',
    toolUseCount: 37,
    totalTokens: 33400,
    ...overrides,
  };
}

describe('TaskPanel', () => {
  it('renders agent rows with Claude Code style tree structure', () => {
    const {lastFrame} = render(
      <TaskPanel
        tasks={[
          createTask(),
          createTask({
            id: 'run-2',
            name: 'Fix all tests/ TS + lint errors',
            detail: 'Search: langgraph',
            toolUseCount: 62,
            totalTokens: 97900,
          }),
        ]}
        runningCount={2}
        pausedCount={0}
        doneCount={0}
        errorCount={0}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('⏺ Running 2 agents… (ctrl+o to expand)');
    expect(frame).toContain('├─ Fix all src/ TS + lint errors · 37 tool uses · 33.4k tokens');
    expect(frame).toContain('│  ⎿ Update: src/gateway/session-manager.ts');
    expect(frame).toContain('└─ Fix all tests/ TS + lint errors · 62 tool uses · 97.9k tokens');
    expect(frame).toContain('   ⎿ Search: langgraph');
  });

  it('shows collapsed tool-use count hint when only one detail line is visible', () => {
    const {lastFrame} = render(
      <TaskPanel
        tasks={[
          createTask({
            toolUseCount: 17,
            detail: 'Bash: Run test suite',
          }),
        ]}
        runningCount={1}
        pausedCount={0}
        doneCount={0}
        errorCount={0}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('⏺ Running 1 agent… (ctrl+o to expand)');
    expect(frame).toContain('└─ Fix all src/ TS + lint errors · 17 tool uses · 33.4k tokens');
    expect(frame).toContain('   ⎿ Bash: Run test suite');
    expect(frame).toContain('+16 more tool uses (ctrl+o to expand)');
  });

  it('shows additional tool detail lines when expanded', () => {
    const {lastFrame} = render(
      <TaskPanel
        tasks={[
          createTask({
            detail: [
              'Update: src/integration/a2a/transport/http.ts',
              'Read(src/integration/a2a/transport/http.ts)',
              'Read(src/integration/a2a/transport/http.ts)',
            ].join('\n'),
            toolUseCount: 49,
          }),
        ]}
        runningCount={1}
        pausedCount={0}
        doneCount={0}
        errorCount={0}
        expanded
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('⏺ Running 1 agent… (ctrl+o to collapse)');
    expect(frame).toContain('   ⎿ Update: src/integration/a2a/transport/http.ts');
    expect(frame).toContain('   ⎿ Read: src/integration/a2a/transport/http.ts');
    expect(frame).toContain('(ctrl+o to collapse)');
  });

  it('uses waiting state text for paused agents', () => {
    const {lastFrame} = render(
      <TaskPanel
        tasks={[
          createTask({
            id: 'paused-1',
            name: 'Review risky write',
            status: 'paused',
            detail: 'Waiting for approval on dangerous_tool',
            toolUseCount: 1,
            totalTokens: undefined,
          }),
        ]}
        runningCount={0}
        pausedCount={1}
        doneCount={0}
        errorCount={0}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain('⏺ 1 agent waiting… (ctrl+o to expand)');
    expect(frame).toContain('└─ Review risky write · 1 tool uses');
    expect(frame).toContain('⎿ Waiting for approval on dangerous_tool');
  });
});

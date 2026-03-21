import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveTask} from '../../hooks/use-active-tasks';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';
import {theme} from '../../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

interface TaskPanelProps {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount?: number;
}

function buildTaskSummary(runningCount: number, pausedCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (pausedCount > 0) parts.push(`${pausedCount} paused`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

function TaskCheckbox({status, frame}: {status: ActiveTask['status']; frame: number}): React.JSX.Element {
  switch (status) {
    case 'running': {
      const spinner = BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length];
      return <Text color={theme.status.running}>[{spinner}]</Text>;
    }
    case 'done':
      return <Text color={theme.status.done}>[✓]</Text>;
    case 'error':
      return <Text color={theme.status.error}>[✕]</Text>;
    case 'paused':
      return <Text color={theme.status.paused}>[⏸]</Text>;
  }
}

export function TaskPanel({tasks, runningCount, pausedCount, doneCount, errorCount, hiddenCount = 0}: TaskPanelProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runningCount === 0) return;

    const timer = setInterval(() => {
      setFrame(current => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runningCount]);

  if (tasks.length === 0) return null;

  const summary = buildTaskSummary(runningCount, pausedCount, doneCount, errorCount);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.chrome.border} paddingX={1}>
      <Text dimColor bold>Tasks ({summary})</Text>
      {tasks.map(task => {
        return (
          <Box key={task.id} gap={1}>
            <TaskCheckbox status={task.status} frame={frame} />
            <Text wrap="truncate-end">{task.name}</Text>
          </Box>
        );
      })}
      {hiddenCount > 0 ? (
        <Text dimColor>{`+${hiddenCount} more`}</Text>
      ) : null}
    </Box>
  );
}

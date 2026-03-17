import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveTask} from '../../hooks/use-active-tasks';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';
import {formatElapsedMs} from '../../utils/format';
import {theme} from '../../utils/theme';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Maximum characters for task name column before truncation. */
const TASK_NAME_MAX_WIDTH = 30;

/** Minimum characters for elapsed time column. */
const ELAPSED_MIN_WIDTH = 6;

interface TaskPanelProps {
  tasks: ActiveTask[];
  runningCount: number;
  doneCount: number;
  errorCount: number;
}

function buildTaskSummary(runningCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

const TASK_STATUS_COLOR: Record<ActiveTask['status'], string> = {
  running: theme.status.running,
  done: theme.status.done,
  error: theme.status.error,
  paused: theme.status.paused,
};

const TASK_STATUS_LABEL: Record<ActiveTask['status'], string> = {
  running: 'running',
  done: 'done',
  error: 'failed',
  paused: 'paused',
};

function TaskIcon({status, frame}: {status: ActiveTask['status']; frame: number}): React.JSX.Element {
  const color = TASK_STATUS_COLOR[status];
  switch (status) {
    case 'running':
      return <Text color={color}>{BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length]}</Text>;
    case 'done':
      return <Text color={color}>✓</Text>;
    case 'error':
      return <Text color={color}>✕</Text>;
    case 'paused':
      return <Text color={color}>⏸</Text>;
  }
}

function TaskStatusText({status}: {status: ActiveTask['status']}): React.JSX.Element {
  return <Text color={TASK_STATUS_COLOR[status]}>{TASK_STATUS_LABEL[status]}</Text>;
}

export function TaskPanel({tasks, runningCount, doneCount, errorCount}: TaskPanelProps): React.JSX.Element | null {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (runningCount === 0) return;

    const timer = setInterval(() => {
      setFrame(current => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [runningCount]);

  if (tasks.length === 0) return null;

  const summary = buildTaskSummary(runningCount, doneCount, errorCount);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.chrome.border} paddingX={1}>
      <Text dimColor bold>Tasks ({summary})</Text>
      {tasks.map(task => {
        const statParts: string[] = [];
        if (task.toolUseCount) statParts.push(`${task.toolUseCount} tools`);
        if (task.totalTokens) statParts.push(`${task.totalTokens} tok`);
        const statSuffix = statParts.length > 0 ? `  ${statParts.join(' · ')}` : '';
        return (
          <Box key={task.id} gap={1}>
            <TaskIcon status={task.status} frame={frame} />
            <Text wrap="truncate-end">{task.name.padEnd(TASK_NAME_MAX_WIDTH)}</Text>
            <TaskStatusText status={task.status} />
            <Text dimColor>{formatElapsedMs(task.elapsed).padStart(ELAPSED_MIN_WIDTH)}{statSuffix}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

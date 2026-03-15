import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {ActiveTask} from '../../hooks/use-active-tasks';
import {SPINNER_INTERVAL_MS} from '../../hooks/use-status-indicator';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

interface TaskPanelProps {
  tasks: ActiveTask[];
  runningCount: number;
  doneCount: number;
  errorCount: number;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining.toString().padStart(2, '0')}s`;
}

function buildTaskSummary(runningCount: number, doneCount: number, errorCount: number): string {
  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} running`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} failed`);
  return parts.join(', ');
}

function TaskIcon({status, frame}: {status: ActiveTask['status']; frame: number}): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Text color="yellow">{BRAILLE_FRAMES[((frame % BRAILLE_FRAMES.length) + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length]}</Text>;
    case 'done':
      return <Text color="green">✓</Text>;
    case 'error':
      return <Text color="red">✕</Text>;
    case 'paused':
      return <Text color="blueBright">⏸</Text>;
  }
}

function TaskStatusText({status}: {status: ActiveTask['status']}): React.JSX.Element {
  const colorMap: Record<string, string> = {
    running: 'yellow',
    done: 'green',
    error: 'red',
    paused: 'blueBright',
  };
  const labelMap: Record<string, string> = {
    running: 'running',
    done: 'done',
    error: 'failed',
    paused: 'paused',
  };
  return <Text color={colorMap[status]}>{labelMap[status]}</Text>;
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
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor bold>Tasks ({summary})</Text>
      {tasks.map(task => (
        <Box key={task.id} gap={1}>
          <TaskIcon status={task.status} frame={frame} />
          <Text>{task.name.padEnd(30)}</Text>
          <TaskStatusText status={task.status} />
          <Text dimColor>{formatElapsed(task.elapsed).padStart(6)}</Text>
        </Box>
      ))}
    </Box>
  );
}

import React from 'react';
import {Box, Text} from 'ink';
import type {ActiveTask} from '../../hooks/use-active-tasks';
import {formatTokenCount} from '../../utils/format';

const COLORS = {
  bullet: '#E5E510',
  tree: '#89B4FA',
  tool: '#E5E510',
  text: '#FFFFFF',
  meta: '#94A3B8',
} as const;

const MAX_VISIBLE_DETAIL_LINES = 3;

interface TaskPanelProps {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  expanded?: boolean;
}

function buildHeader(runningCount: number, pausedCount: number, errorCount: number, taskCount: number): string {
  if (runningCount > 0) {
    return `Running ${runningCount} agent${runningCount === 1 ? '' : 's'}…`;
  }

  if (pausedCount > 0) {
    return `${pausedCount} agent${pausedCount === 1 ? '' : 's'} waiting…`;
  }

  if (errorCount > 0) {
    return `Recent ${taskCount} agent${taskCount === 1 ? '' : 's'}`;
  }

  return `Recent ${taskCount} agent${taskCount === 1 ? '' : 's'}`;
}

function buildSummary(task: ActiveTask): string {
  const parts = [task.name];
  if (task.toolUseCount !== undefined) {
    parts.push(`${task.toolUseCount} tool uses`);
  }
  if (task.totalTokens !== undefined) {
    parts.push(`${formatTokenCount(task.totalTokens)} tokens`);
  }
  return parts.join(' · ');
}

function splitDetailLines(detail?: string): string[] {
  if (!detail) {
    return [];
  }

  return detail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseToolLine(line: string): {toolLabel?: string; content: string} {
  const typedAction = line.match(/^([A-Za-z][A-Za-z /_-]{1,24}):(.*)$/);
  if (typedAction) {
    return {
      toolLabel: typedAction[1]!.trim(),
      content: typedAction[2]!.trim(),
    };
  }

  const callStyle = line.match(/^([A-Za-z][A-Za-z /_-]{1,24})\((.*)\)$/);
  if (callStyle) {
    return {
      toolLabel: callStyle[1]!.trim(),
      content: callStyle[2]!.trim(),
    };
  }

  return {content: line};
}

function StepLine({line, isLastTask}: {line: string; isLastTask: boolean}): React.JSX.Element {
  const parsed = parseToolLine(line);

  return (
    <Box>
      <Text color={COLORS.tree}>{isLastTask ? '   ' : '│  '}</Text>
      <Text color={COLORS.bullet}>{'⎿ '}</Text>
      {parsed.toolLabel ? <Text color={COLORS.tool}>{`${parsed.toolLabel}: `}</Text> : null}
      <Text color={COLORS.text} wrap="truncate-end">{parsed.content}</Text>
    </Box>
  );
}

function MoreLine({count, expanded, isLastTask}: {count: number; expanded: boolean; isLastTask: boolean}): React.JSX.Element {
  return (
    <Box>
      <Text color={COLORS.tree}>{isLastTask ? '   ' : '│  '}</Text>
      <Text color={COLORS.meta}>
        {expanded ? '(ctrl+o to collapse)' : `+${count} more tool uses (ctrl+o to expand)`}
      </Text>
    </Box>
  );
}

function AgentRow({
  task,
  isLastTask,
  expanded,
}: {
  task: ActiveTask;
  isLastTask: boolean;
  expanded: boolean;
}): React.JSX.Element {
  const allDetailLines = splitDetailLines(task.detail);
  const visibleDetailLines = expanded ? allDetailLines : allDetailLines.slice(0, 1);
  const hiddenCount = expanded
    ? 0
    : Math.max(
        0,
        task.toolUseCount !== undefined
          ? task.toolUseCount - visibleDetailLines.length
          : allDetailLines.length - visibleDetailLines.length,
      );

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={COLORS.tree}>{`   ${isLastTask ? '└─' : '├─'} `}</Text>
        <Text color={COLORS.text} wrap="truncate-end">{buildSummary(task)}</Text>
      </Box>
      {visibleDetailLines.map((line, index) => (
        <StepLine key={`${task.id}-detail-${index}`} line={line} isLastTask={isLastTask} />
      ))}
      {(hiddenCount > 0 || (expanded && allDetailLines.length > 1)) ? (
        <MoreLine
          count={hiddenCount}
          expanded={expanded}
          isLastTask={isLastTask}
        />
      ) : null}
    </Box>
  );
}

export function TaskPanel({
  tasks,
  runningCount,
  pausedCount,
  doneCount: _doneCount,
  errorCount,
  expanded = false,
}: TaskPanelProps): React.JSX.Element | null {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={COLORS.bullet}>{'⏺ '}</Text>
        <Text color={COLORS.text}>{buildHeader(runningCount, pausedCount, errorCount, tasks.length)}</Text>
        <Text color={COLORS.meta}>{expanded ? ' (ctrl+o to collapse)' : ' (ctrl+o to expand)'}</Text>
      </Box>
      {tasks.map((task, index) => (
        <AgentRow
          key={task.id}
          task={task}
          isLastTask={index === tasks.length - 1}
          expanded={expanded}
        />
      ))}
    </Box>
  );
}

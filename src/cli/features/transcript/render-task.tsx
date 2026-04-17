/**
 * Task execution block: renders an active/completed subagent run with
 * spinner, label, summary stats, and optional expanded child-item list.
 */
import React from 'react';
import {Box, Text} from 'ink';
import type {ActiveSubagentRun} from '../subagent/use-runs';
import type {ToolResultMeta, TranscriptItem} from './model';
import {formatToolHeaderArgs} from '../../../shared/tool-display';
import {formatElapsedMs, formatTokenCount} from '../../utils/format';
import {BRAILLE_FRAMES, SPINNER_INTERVAL_MS} from '../../utils/theme';

type TaskStatus = 'running' | 'paused' | 'done' | 'error';

function parseSummaryLine(summaryLine: string): {status: string; stats: string} {
  const match = summaryLine.match(/^(.*?)\s*\((.*)\)$/);
  if (!match) {
    return {status: summaryLine, stats: ''};
  }
  return {
    status: match[1]?.trim() || summaryLine,
    stats: match[2]?.trim() || '',
  };
}

function parseSubagentRunId(itemId: string): string | undefined {
  const prefix = 'active-subagent-run:';
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : undefined;
}

export function resolveSubagentRunId(
  item: TranscriptItem & {toolMeta: ToolResultMeta},
): string | undefined {
  return item.toolMeta.runId ?? parseSubagentRunId(item.id);
}

function isDurationStat(part: string): boolean {
  return /^(\d+(\.\d+)?)(ms|s|m|h)$/.test(part);
}

function renderTaskStatsLine(task: ActiveSubagentRun | undefined, meta: ToolResultMeta): string | undefined {
  const parts: string[] = [];
  if (task) {
    if (task.toolUseCount) {
      parts.push(`${task.toolUseCount} tool uses`);
    }
    if (task.totalTokens) {
      parts.push(`${formatTokenCount(task.totalTokens)} tokens`);
    }
  }

  const {stats} = parseSummaryLine(meta.summaryLine);
  if (stats && parts.length === 0) {
    const fallbackParts = stats.split(' · ').map((part) => part.trim()).filter(Boolean);
    const filtered = fallbackParts.filter((part) => {
      if (meta.elapsed && part === meta.elapsed) {
        return false;
      }
      if (task && isDurationStat(part)) {
        return false;
      }
      return true;
    });
    for (const part of filtered) {
      if (!parts.includes(part)) {
        parts.push(part);
      }
    }
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function formatTaskExecutionHeader(
  meta: ToolResultMeta,
  status: TaskStatus,
  activeTask: ActiveSubagentRun | undefined,
  spinnerFrame?: number,
): string {
  const prefix = status === 'running'
    ? BRAILLE_FRAMES[((spinnerFrame ?? 0) % BRAILLE_FRAMES.length + BRAILLE_FRAMES.length) % BRAILLE_FRAMES.length]
    : status === 'paused'
      ? '⏸'
      : status === 'error'
        ? '✕'
        : '⏺';
  const label = formatTaskExecutionLabel(meta, activeTask);
  return `${prefix} ${label}`;
}

function formatTaskExecutionLabel(meta: ToolResultMeta, activeTask: ActiveSubagentRun | undefined): string {
  if (activeTask?.name) {
    const colonIndex = activeTask.name.indexOf(': ');
    if (colonIndex > 0) {
      const agent = activeTask.name.slice(0, colonIndex).trim();
      const goal = activeTask.name.slice(colonIndex + 2).trim();
      const conciseGoal = formatToolHeaderArgs(meta.toolName, goal);
      return conciseGoal ? `${agent}(${conciseGoal})` : agent;
    }
    return formatToolHeaderArgs(meta.toolName, activeTask.name) ?? activeTask.name;
  }

  const conciseArgs = formatToolHeaderArgs(meta.toolName, meta.args);
  return conciseArgs ? `${meta.displayName}(${conciseArgs})` : meta.displayName;
}

function formatSingleTaskSummaryLine(meta: ToolResultMeta, activeTask: ActiveSubagentRun | undefined): string {
  const {status} = parseSummaryLine(meta.summaryLine);
  const summaryStatus = activeTask?.status === 'paused'
    ? 'Waiting for review'
    : status || 'Running';
  const parts: string[] = [];
  const stats = renderTaskStatsLine(activeTask, meta);
  if (stats) {
    parts.push(stats);
  }

  if (activeTask) {
    const elapsedSeconds = Math.floor(activeTask.elapsed / 1000);
    parts.push(elapsedSeconds < 120 ? `${elapsedSeconds}s` : formatElapsedMs(activeTask.elapsed));
  } else if (meta.elapsed) {
    parts.push(meta.elapsed);
  }

  return parts.length > 0 ? `${summaryStatus} (${parts.join(' · ')})` : summaryStatus;
}

function formatSyntheticTaskSummaryLine(
  task: ActiveSubagentRun | undefined,
  fallback: string = 'Done',
): string {
  if (!task) {
    return fallback;
  }

  const parts: string[] = [];
  if (typeof task.toolUseCount === 'number' && task.toolUseCount > 0) {
    parts.push(`${task.toolUseCount} tool use${task.toolUseCount === 1 ? '' : 's'}`);
  }
  if (typeof task.totalTokens === 'number' && task.totalTokens > 0) {
    parts.push(`${formatTokenCount(task.totalTokens)} tokens`);
  }
  if (parts.length === 0) {
    const {stats} = parseSummaryLine(fallback);
    const fallbackStats = stats
      .split(' · ')
      .map((part) => part.trim())
      .filter((part) => part && !isDurationStat(part));
    for (const part of fallbackStats) {
      if (!parts.includes(part)) {
        parts.push(part);
      }
    }
  }
  const elapsedSeconds = Math.floor(task.elapsed / 1000);
  parts.push(elapsedSeconds < 120 ? `${elapsedSeconds}s` : formatElapsedMs(task.elapsed));

  if (task.status === 'paused') {
    return `Waiting for review (${parts.join(' · ')})`;
  }
  if (task.status === 'error') {
    return `Failed (${parts.join(' · ')})`;
  }
  if (task.status === 'done') {
    return `Done (${parts.join(' · ')})`;
  }
  return `Running (${parts.join(' · ')})`;
}

interface SingleTaskExecutionBlockProps {
  item: TranscriptItem & {toolMeta: ToolResultMeta};
  activeTask?: ActiveSubagentRun;
  expanded?: boolean;
  detailItems?: readonly TranscriptItem[];
  subagentDetails?: ReadonlyMap<string, TranscriptItem[]>;
  /** Injected recursive renderer so the task block can expand child items without importing render.tsx. */
  renderChildren: (items: TranscriptItem[], subagentDetails?: ReadonlyMap<string, TranscriptItem[]>) => React.JSX.Element;
}

export function SingleTaskExecutionBlock({
  item,
  activeTask,
  expanded = false,
  detailItems = [],
  subagentDetails,
  renderChildren,
}: SingleTaskExecutionBlockProps): React.JSX.Element {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (item.toolMeta.status !== 'running' || activeTask?.status === 'paused') {
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [item.toolMeta.status, activeTask?.status]);

  const status: TaskStatus = activeTask?.status === 'paused'
    ? 'paused'
    : activeTask?.status === 'error'
      ? 'error'
      : activeTask?.status === 'done'
        ? 'done'
        : item.toolMeta.status;
  const summaryLine = status === 'done' || status === 'error'
    ? formatSyntheticTaskSummaryLine(activeTask, item.toolMeta.summaryLine)
    : formatSingleTaskSummaryLine(item.toolMeta, activeTask);
  const visibleDetailItems = detailItems.filter((detailItem) => detailItem.role === 'tool');

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold wrap="truncate-end">{formatTaskExecutionHeader(item.toolMeta, status, activeTask, frame)}</Text>
      <Text dimColor wrap="truncate-end">{`  ⎿ ${summaryLine}`}</Text>
      {expanded && visibleDetailItems.length > 0 ? (
        <Box paddingLeft={4} marginTop={1}>
          {renderChildren(visibleDetailItems as TranscriptItem[], subagentDetails)}
        </Box>
      ) : null}
    </Box>
  );
}

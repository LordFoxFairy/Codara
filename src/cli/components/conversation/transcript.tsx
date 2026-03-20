import React from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import type {ActiveTask} from '../../hooks/use-active-tasks';
import {buildTranscriptItems, type ToolResultMeta, type TranscriptRole} from '../../transcript/model';
import {formatElapsedMs, formatTokenCount} from '../../utils/format';
import {theme} from '../../utils/theme';
import {DiffView} from './diff-view';
import {MarkdownText} from './markdown-text';

interface TranscriptProps {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
}

const ROLE_LABEL_MAP: Record<TranscriptRole, string> = {
  system: 'system',
  warning: 'warning',
  user: 'you',
  assistant: 'codara',
  tool: 'tools',
  task: 'tasks',
  hil: 'review',
  command: 'command',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<TranscriptRole, React.ComponentProps<typeof Text>['color']> = theme.role;

export function Transcript({coreMessages, notices, activeTurn, runtimeEvents}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn, runtimeEvents});
  return <TranscriptItemsView items={items} />;
}

function getRolePrefix(role: TranscriptRole): { text: string; width: number } {
  switch (role) {
    case 'user': return { text: '> ', width: 2 };
    case 'assistant': return { text: '', width: 0 };
    case 'command': return { text: '', width: 0 };
    case 'tool': return { text: '', width: 0 };
    case 'task': return { text: '', width: 0 };
    default: return { text: `${ROLE_LABEL_MAP[role]} `, width: ROLE_LABEL_MAP[role].length + 1 };
  }
}

export function TranscriptBlock({role, content, renderHint, tokenAnnotation}: {role: TranscriptRole; content: string; renderHint?: 'inline' | 'block'; tokenAnnotation?: string}): React.JSX.Element {
  const lines = content.split('\n');
  const prefix = getRolePrefix(role);
  const firstLine = lines[0] || '(empty)';
  const trailingLines = lines.slice(1);
  const isToolResult = role === 'tool' || role === 'task';
  // Tool results use ⎿ tree connector style
  if (isToolResult && trailingLines.length > 0) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color={ROLE_COLOR_MAP[role]}>{prefix.text}</Text>
          <Text>{firstLine}</Text>
        </Box>
        {renderHint === 'block' ? (
          <Box paddingLeft={prefix.width} flexDirection="column">
            {trailingLines.map((line, index) => (
              <Text key={`${role}-${index}`} dimColor>
                {'│ '}{line || ' '}
              </Text>
            ))}
          </Box>
        ) : (
          <Box paddingLeft={prefix.width} flexDirection="column">
            {trailingLines.map((line, index) => (
              <Text key={`${role}-${index}`} dimColor>
                {index === trailingLines.length - 1 ? '⎿ ' : '│ '}{line || ' '}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Tool call headers (single line) get ⎿ for result
  if (isToolResult && trailingLines.length === 0) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text color={ROLE_COLOR_MAP[role]}>{prefix.text}</Text>
          <Text>{firstLine}</Text>
        </Box>
      </Box>
    );
  }

  // Assistant messages get markdown rendering
  if (role === 'assistant') {
    return (
      <Box marginBottom={1} flexDirection="column">
        <MarkdownText content={content} />
        {tokenAnnotation && <Text dimColor>  {tokenAnnotation}</Text>}
      </Box>
    );
  }

  // User messages wrap naturally; other roles truncate to keep output compact
  const textWrap = role === 'user' ? 'wrap' : 'truncate-end';

  return (
    <Box marginBottom={1} flexDirection="column">
      <Box>
        <Text color={ROLE_COLOR_MAP[role]} bold={role === 'user'}>{prefix.text}</Text>
        <Text wrap={textWrap}>{firstLine}</Text>
      </Box>
      {trailingLines.length > 0 ? (
        <Box paddingLeft={prefix.width} flexDirection="column">
          {trailingLines.map((line, index) => (
            <Text key={`${role}-${index}`} wrap={textWrap}>
              {line || ' '}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

const EDIT_LINE_COLORS: Record<string, React.ComponentProps<typeof Text>['color']> = {
  '+': theme.diff.addition,
  '-': theme.diff.deletion,
};

export function ToolResultBlock({meta, expanded = false}: {meta: ToolResultMeta; expanded?: boolean}): React.JSX.Element {
  const {icon, displayName, args, summaryLine, outputLines, allOutputLines, totalOutputLines, status, elapsed, diffData} = meta;
  const elapsedSuffix = elapsed ? ` (${elapsed})` : '';
  const header = args ? `${icon} ${displayName}(${args})${elapsedSuffix}` : `${icon} ${displayName}${elapsedSuffix}`;
  const visibleLines = expanded && allOutputLines?.length ? allOutputLines : outputLines;
  const hiddenLines = expanded ? 0 : (totalOutputLines ?? 0) - (outputLines?.length ?? 0);
  const isEdit = meta.toolName === 'edit' || meta.toolName === 'edit_file';
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold>{header}</Text>
      <Box>
        <Text dimColor color={status === 'error' ? 'red' : undefined}>
          {'  ⎿ '}{summaryLine}
        </Text>
      </Box>
      {diffData ? (
        <DiffView diff={diffData} />
      ) : visibleLines && visibleLines.length > 0 ? (
        <Box paddingLeft={4} flexDirection="column">
          {visibleLines.map((line, index) => {
            const lineColor = isEdit ? EDIT_LINE_COLORS[line.charAt(0)] : undefined;
            return (
              <Text key={index} dimColor color={lineColor} wrap="truncate-end">
                {line}
              </Text>
            );
          })}
          {hiddenLines > 0 ? (
            <Text dimColor>{`… +${hiddenLines} lines (ctrl+o to expand)`}</Text>
          ) : expanded && (totalOutputLines ?? 0) > (outputLines?.length ?? 0) ? (
            <Text dimColor>{'(ctrl+o to collapse)'}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function isRunningTaskTranscriptItem(item: import('../../transcript/model').TranscriptItem): item is import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta} {
  return item.role === 'task' && item.toolMeta?.status === 'running';
}

function isCompletedTaskTranscriptItem(item: import('../../transcript/model').TranscriptItem): item is import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta} {
  return item.role === 'task' && item.toolMeta?.status === 'done';
}

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

function parseTaskRunId(itemId: string): string | undefined {
  const prefix = 'active-task-run:';
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : undefined;
}

function renderTaskActivityLines(meta: ToolResultMeta, expanded: boolean): {lines: string[]; hiddenCount: number} {
  const allLines = meta.allOutputLines ?? meta.outputLines ?? [];
  if (allLines.length === 0) {
    return {lines: [], hiddenCount: 0};
  }

  if (expanded) {
    return {lines: allLines, hiddenCount: 0};
  }

  const latestLine = allLines[allLines.length - 1];
  return {
    lines: latestLine ? [latestLine] : [],
    hiddenCount: Math.max(allLines.length - 1, 0),
  };
}

function renderTaskStatsLine(task: ActiveTask | undefined, meta: ToolResultMeta): string | undefined {
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
    const filtered = meta.elapsed ? fallbackParts.filter((part) => part !== meta.elapsed) : fallbackParts;
    for (const part of filtered) {
      if (!parts.includes(part)) {
        parts.push(part);
      }
    }
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function renderTaskActivityLine(
  lines: string[],
  activeTask: ActiveTask | undefined,
  status: 'running' | 'paused' | 'done' | 'error',
): string | undefined {
  if ((status === 'running' || status === 'paused') && activeTask?.detail) {
    return activeTask.detail;
  }

  if (lines.length > 0) {
    return lines[lines.length - 1];
  }

  return undefined;
}

function formatTaskExecutionHeader(
  meta: ToolResultMeta,
  status: 'running' | 'paused' | 'done' | 'error',
  activeTask: ActiveTask | undefined,
  spinnerFrame?: number,
): string {
  const prefix = status === 'running'
    ? TASK_SPINNER_FRAMES[((spinnerFrame ?? 0) % TASK_SPINNER_FRAMES.length + TASK_SPINNER_FRAMES.length) % TASK_SPINNER_FRAMES.length]
    : status === 'paused'
      ? '⏸'
      : status === 'error'
        ? '✕'
        : '⏺';
  const label = formatTaskExecutionLabel(meta, activeTask);
  return `${prefix} ${label}`;
}

function formatTaskExecutionLabel(meta: ToolResultMeta, activeTask: ActiveTask | undefined): string {
  if (activeTask?.name) {
    const colonIndex = activeTask.name.indexOf(': ');
    if (colonIndex > 0) {
      const agent = activeTask.name.slice(0, colonIndex).trim();
      const goal = activeTask.name.slice(colonIndex + 2).trim();
      return `${agent}(${goal})`;
    }
    return activeTask.name;
  }

  return meta.args ? `${meta.displayName}(${meta.args})` : meta.displayName;
}

function formatSingleTaskSummaryLine(meta: ToolResultMeta, activeTask: ActiveTask | undefined): string {
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

function SingleTaskExecutionBlock({
  item,
  activeTask,
  expanded = false,
}: {
  item: import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta};
  activeTask?: ActiveTask;
  expanded?: boolean;
}): React.JSX.Element {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (item.toolMeta.status !== 'running' || activeTask?.status === 'paused') {
      return;
    }

    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, TASK_SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [item.toolMeta.status, activeTask?.status]);

  const {lines, hiddenCount} = renderTaskActivityLines(item.toolMeta, expanded);
  const status = item.toolMeta.status === 'done'
    ? 'done'
    : activeTask?.status === 'paused'
      ? 'paused'
      : item.toolMeta.status;
  const latestActivity = renderTaskActivityLine(lines, activeTask, status);
  const summaryLine = item.toolMeta.status === 'done'
    ? item.toolMeta.summaryLine
    : formatSingleTaskSummaryLine(item.toolMeta, activeTask);

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold wrap="truncate-end">{formatTaskExecutionHeader(item.toolMeta, status, activeTask, frame)}</Text>
      <Text dimColor wrap="truncate-end">{`  ⎿ ${summaryLine}`}</Text>
      {latestActivity ? (
        <Text dimColor wrap="truncate-end">{`    ⎿ ${latestActivity}`}</Text>
      ) : null}
      {hiddenCount > 0 ? (
        <Text dimColor wrap="truncate-end">{`    … +${hiddenCount} more activity line${hiddenCount === 1 ? '' : 's'} (ctrl+o to expand)`}</Text>
      ) : null}
    </Box>
  );
}

const TASK_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const TASK_SPINNER_INTERVAL_MS = 80;

function RunningTaskGroupBlock({
  items,
  activeTasks = [],
  expanded = false,
}: {
  items: Array<import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}>;
  activeTasks?: readonly ActiveTask[];
  expanded?: boolean;
}): React.JSX.Element {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, TASK_SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const total = items.length;
  const activeTasksById = new Map(activeTasks.map((task) => [task.id, task]));
  const hasExpandableContent = items.some((item) => (item.toolMeta.allOutputLines?.length ?? item.toolMeta.outputLines?.length ?? 0) > 1);
  const firstRunId = parseTaskRunId(items[0]?.id ?? '');
  const singleTask = total === 1 && firstRunId ? activeTasksById.get(firstRunId) : undefined;
  if (total === 1) {
    return (
      <SingleTaskExecutionBlock
        item={items[0]!}
        activeTask={singleTask}
        expanded={expanded}
      />
    );
  }
  const hasLiveTask = items.some((item) => {
    const runId = parseTaskRunId(item.id);
    const activeTask = runId ? activeTasksById.get(runId) : undefined;
    return activeTask?.status === 'running' || activeTask?.status === 'paused' || item.toolMeta.status === 'running';
  });
  const spinner = TASK_SPINNER_FRAMES[((frame % TASK_SPINNER_FRAMES.length) + TASK_SPINNER_FRAMES.length) % TASK_SPINNER_FRAMES.length];
  const headerBase = hasLiveTask ? `${spinner} Running ${total} agents...` : `⏺ Completed ${total} agents...`;
  const headerSuffix = !expanded && hasExpandableContent ? ' (ctrl+o to expand)' : expanded && hasExpandableContent ? ' (ctrl+o to collapse)' : '';

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold>{`${headerBase}${headerSuffix}`}</Text>
      {items.map((item, index) => {
        const rowPrefix = index === items.length - 1 ? '└─ ' : '├─ ';
        const branchPrefix = index === items.length - 1 ? '   ' : '│  ';
        const runId = parseTaskRunId(item.id);
        const activeTask = runId ? activeTasksById.get(runId) : undefined;
        const {lines, hiddenCount} = renderTaskActivityLines(item.toolMeta, expanded);
        const rowLabel = formatTaskExecutionLabel(item.toolMeta, activeTask);
        const rowStatus = activeTask?.status === 'paused'
          ? 'paused'
          : activeTask?.status === 'error'
            ? 'error'
            : activeTask?.status === 'done'
              ? 'done'
              : item.toolMeta.status;
        const rowSummary = rowStatus === 'done' || rowStatus === 'error'
          ? formatSyntheticTaskSummaryLine(activeTask, item.toolMeta.summaryLine)
          : formatSingleTaskSummaryLine(item.toolMeta, activeTask);
        const latestActivity = renderTaskActivityLine(lines, activeTask, rowStatus);

        return (
          <Box key={item.id} flexDirection="column">
            <Text wrap="truncate-end">{`${rowPrefix}${rowLabel}`}</Text>
            <Text dimColor wrap="truncate-end">
              {`${branchPrefix}⎿ ${rowSummary}`}
            </Text>
            {latestActivity && rowStatus !== 'done' && rowStatus !== 'error' ? (
              <Text dimColor wrap="truncate-end">
                {`${branchPrefix}  ⎿ ${latestActivity}`}
              </Text>
            ) : null}
            {hiddenCount > 0 ? (
              <Text dimColor wrap="truncate-end">
                {`${branchPrefix}… +${hiddenCount} more activity line${hiddenCount === 1 ? '' : 's'}`}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

function projectExecutionTreeItems(
  items: import('../../transcript/model').TranscriptItem[],
  activeTasks: readonly ActiveTask[],
): import('../../transcript/model').TranscriptItem[] {
  if (activeTasks.length === 0) {
    return items;
  }

  const firstTaskIndex = items.findIndex((item) => item.role === 'task');
  if (firstTaskIndex < 0) {
    return items;
  }

  let lastTaskIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'task') {
      lastTaskIndex = index;
      break;
    }
  }
  if (lastTaskIndex < firstTaskIndex) {
    return items;
  }

  const taskItems = items
    .slice(firstTaskIndex, lastTaskIndex + 1)
    .filter((item) => item.role === 'task' && item.toolMeta) as Array<import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}>;
  const projectedTaskItems = projectTaskItemsFromSummaries(taskItems, activeTasks);

  return [
    ...items.slice(0, firstTaskIndex),
    ...projectedTaskItems,
    ...items.slice(lastTaskIndex + 1),
  ];
}

function projectTaskItemsFromSummaries(
  taskItems: Array<import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}>,
  activeTasks: readonly ActiveTask[],
): Array<import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}> {
  if (activeTasks.length === 0) {
    return taskItems;
  }

  const taskItemsByRunId = new Map(
    taskItems
      .map((item) => [parseTaskRunId(item.id), item] as const)
      .filter((entry): entry is [string, import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}] => Boolean(entry[0])),
  );

  return [...activeTasks]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((task) => taskItemsByRunId.get(task.id) ?? createSyntheticTaskItem(task));
}

function createSyntheticTaskItem(
  task: ActiveTask,
): import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta} {
  const {displayName, args} = splitTaskDisplay(task.name);
  const summaryLine = formatSyntheticTaskSummaryLine(task);
  return {
    id: `active-task-run:${task.id}`,
    role: 'task',
    content: `⚙ ${displayName}${args ? `(${args})` : ''}\n${summaryLine}`,
    toolMeta: {
      toolName: 'Task',
      displayName,
      icon: '⚙',
      ...(args ? {args} : {}),
      status: task.status === 'error' ? 'error' : task.status === 'done' ? 'done' : 'running',
      summaryLine,
    },
  };
}

function splitTaskDisplay(name: string): {displayName: string; args?: string} {
  const colonIndex = name.indexOf(': ');
  if (colonIndex <= 0) {
    return {displayName: name};
  }

  return {
    displayName: name.slice(0, colonIndex).trim(),
    args: name.slice(colonIndex + 2).trim(),
  };
}

function formatSyntheticTaskSummaryLine(
  task: ActiveTask | undefined,
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

/** Renders pre-filtered active (streaming) transcript items. */
export function ActiveTranscript({
  items,
  activeTasks = [],
  expandedAll = false,
}: {
  items: import('../../transcript/model').TranscriptItem[];
  activeTasks?: readonly ActiveTask[];
  expandedAll?: boolean;
}): React.JSX.Element {
  return <TranscriptItemsView items={items} activeTasks={activeTasks} expandedAll={expandedAll} />;
}

export function TranscriptItemsView({
  items,
  activeTasks = [],
  expandedAll = false,
}: {
  items: import('../../transcript/model').TranscriptItem[];
  activeTasks?: readonly ActiveTask[];
  expandedAll?: boolean;
}): React.JSX.Element {
  const projectedItems = projectExecutionTreeItems(items, activeTasks);
  const shouldGroupTaskItems = activeTasks.length > 1;
  const blocks: React.JSX.Element[] = [];

  for (let index = 0; index < projectedItems.length; index += 1) {
    const item = projectedItems[index]!;
    if (shouldGroupTaskItems && item.role === 'task' && item.toolMeta) {
      const groupedItems = [item as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}];
      let cursor = index + 1;
      while (cursor < projectedItems.length && projectedItems[cursor]!.role === 'task' && projectedItems[cursor]!.toolMeta) {
        groupedItems.push(projectedItems[cursor]! as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta});
        cursor += 1;
      }

      blocks.push(
        <RunningTaskGroupBlock
          key={item.id}
          items={groupedItems}
          activeTasks={activeTasks}
          expanded={expandedAll}
        />,
      );
      index = cursor - 1;
      continue;
    }

    if (isRunningTaskTranscriptItem(item)) {
      const groupedItems = [item];
      let cursor = index + 1;
      while (cursor < projectedItems.length && isRunningTaskTranscriptItem(projectedItems[cursor]!)) {
        groupedItems.push(projectedItems[cursor]! as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta});
        cursor += 1;
      }

      blocks.push(
        <RunningTaskGroupBlock
          key={item.id}
          items={groupedItems}
          activeTasks={activeTasks}
          expanded={expandedAll}
        />,
      );
      index = cursor - 1;
      continue;
    }

    if (isCompletedTaskTranscriptItem(item)) {
      blocks.push(
        <SingleTaskExecutionBlock
          key={item.id}
          item={item}
          expanded={expandedAll}
        />,
      );
      continue;
    }

    blocks.push(
      item.toolMeta ? (
        <ToolResultBlock key={item.id} meta={item.toolMeta} expanded={expandedAll} />
      ) : (
        <TranscriptBlock key={item.id} role={item.role} content={item.content} renderHint={item.renderHint} tokenAnnotation={item.tokenAnnotation} />
      ),
    );
  }

  return (
    <Box flexDirection="column">
      {blocks}
    </Box>
  );
}

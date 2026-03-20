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

  return (
    <Box flexDirection="column">
      {items.map((item) =>
        item.toolMeta ? (
          <ToolResultBlock key={item.id} meta={item.toolMeta} />
        ) : (
          <TranscriptBlock key={item.id} role={item.role} content={item.content} renderHint={item.renderHint} tokenAnnotation={item.tokenAnnotation} />
        ),
      )}
    </Box>
  );
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

function formatRunningTaskRow(meta: ToolResultMeta): string {
  const label = meta.args ? `${meta.displayName}: ${meta.args}` : meta.displayName;
  const {status} = parseSummaryLine(meta.summaryLine);
  const tailParts: string[] = [];

  if (status && status !== 'Running') {
    tailParts.push(status);
  }
  if (meta.elapsed) {
    tailParts.push(meta.elapsed);
  }

  return tailParts.length > 0 ? `${label} · ${tailParts.join(' · ')}` : label;
}

function parseTaskRunId(itemId: string): string | undefined {
  const prefix = 'active-task-run:';
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : undefined;
}

function formatRunningTaskRowFromSummary(task: ActiveTask): string {
  const parts = [task.name];
  if (task.status === 'paused') {
    parts.push('Waiting for review');
  }
  if (task.elapsed >= 0) {
    const elapsedSeconds = Math.floor(task.elapsed / 1000);
    parts.push(elapsedSeconds < 120 ? `${elapsedSeconds}s` : formatElapsedMs(task.elapsed));
  }
  return parts.join(' · ');
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
  if (task) {
    const parts: string[] = [];
    if (task.toolUseCount) {
      parts.push(`${task.toolUseCount} tool uses`);
    }
    if (task.totalTokens) {
      parts.push(`${formatTokenCount(task.totalTokens)} tokens`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  const {stats} = parseSummaryLine(meta.summaryLine);
  if (!stats) {
    return undefined;
  }

  const parts = stats.split(' · ').map((part) => part.trim()).filter(Boolean);
  const filtered = meta.elapsed ? parts.filter((part) => part !== meta.elapsed) : parts;
  return filtered.length > 0 ? filtered.join(' · ') : undefined;
}

function renderTaskActivityLine(
  lines: string[],
  activeTask: ActiveTask | undefined,
): string | undefined {
  if (lines.length > 0) {
    return lines[lines.length - 1];
  }

  return activeTask?.detail;
}

function formatCompletedTaskRow(meta: ToolResultMeta): string {
  const label = meta.args ? `✓ ${meta.displayName}: ${meta.args}` : `✓ ${meta.displayName}`;
  const parts = [label];
  if (meta.elapsed) {
    parts.push(meta.elapsed);
  }
  return parts.join(' · ');
}

function CompletedTaskBlock({item, expanded = false}: {item: import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}; expanded?: boolean}): React.JSX.Element {
  const {lines, hiddenCount} = renderTaskActivityLines(item.toolMeta, expanded);
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text wrap="truncate-end">{formatCompletedTaskRow(item.toolMeta)}</Text>
      {lines.map((line, index) => (
        <Text key={`${item.id}-done-${index}`} dimColor wrap="truncate-end">
          {`${index === lines.length - 1 ? '⎿ ' : '│ '}${line}`}
        </Text>
      ))}
      {hiddenCount > 0 ? (
        <Text dimColor wrap="truncate-end">{`… +${hiddenCount} more activity line${hiddenCount === 1 ? '' : 's'} (ctrl+o to expand)`}</Text>
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
  const spinner = TASK_SPINNER_FRAMES[((frame % TASK_SPINNER_FRAMES.length) + TASK_SPINNER_FRAMES.length) % TASK_SPINNER_FRAMES.length];
  const headerBase = total === 1
    ? singleTask?.status === 'paused'
      ? '⏺ Task waiting for review...'
      : `${spinner} Running task...`
    : `${spinner} Running ${total} tasks...`;
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
        const rowLabel = activeTask
          ? formatRunningTaskRowFromSummary(activeTask)
          : formatRunningTaskRow(item.toolMeta);
        const latestActivity = renderTaskActivityLine(lines, activeTask);
        const statsLine = renderTaskStatsLine(activeTask, item.toolMeta);

        return (
          <Box key={item.id} flexDirection="column">
            <Text wrap="truncate-end">{`${rowPrefix}${rowLabel}`}</Text>
            {latestActivity ? (
              <Text dimColor wrap="truncate-end">
                {`${branchPrefix}⎿ ${latestActivity}`}
              </Text>
            ) : null}
            {statsLine ? (
              <Text dimColor wrap="truncate-end">
                {`${branchPrefix}${statsLine}`}
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
  const blocks: React.JSX.Element[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (isRunningTaskTranscriptItem(item)) {
      const groupedItems = [item];
      let cursor = index + 1;
      while (cursor < items.length && isRunningTaskTranscriptItem(items[cursor]!)) {
        groupedItems.push(items[cursor]!);
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
        <CompletedTaskBlock
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

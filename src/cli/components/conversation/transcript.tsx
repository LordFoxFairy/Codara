import React from 'react';
import type {CodaraRuntimeEvent} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {Box, Text} from 'ink';
import type {CliActiveTurn, CliNotice} from '../../app/view-state';
import type {ActiveSubagentRun} from '../../hooks/use-subagent-runs';
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
  subagentDetails?: ReadonlyMap<string, import('../../transcript/model').TranscriptItem[]>;
  expandedAll?: boolean;
}

const ROLE_LABEL_MAP: Record<TranscriptRole, string> = {
  system: 'system',
  warning: 'warning',
  user: 'you',
  assistant: 'codara',
  tool: 'tools',
  agent: 'subagents',
  review: 'review',
  command: 'command',
  error: 'error',
};

const ROLE_COLOR_MAP: Record<TranscriptRole, React.ComponentProps<typeof Text>['color']> = theme.role;

export function Transcript({coreMessages, notices, activeTurn, runtimeEvents, subagentDetails, expandedAll = false}: TranscriptProps): React.JSX.Element {
  const items = buildTranscriptItems({coreMessages, notices, activeTurn, runtimeEvents});
  return <TranscriptItemsView items={items} subagentDetails={subagentDetails} expandedAll={expandedAll} />;
}

function getRolePrefix(role: TranscriptRole): { text: string; width: number } {
  switch (role) {
    case 'user': return { text: '> ', width: 2 };
    case 'assistant': return { text: '', width: 0 };
    case 'command': return { text: '', width: 0 };
    case 'tool': return { text: '', width: 0 };
    case 'agent': return { text: '', width: 0 };
    default: return { text: `${ROLE_LABEL_MAP[role]} `, width: ROLE_LABEL_MAP[role].length + 1 };
  }
}

export function TranscriptBlock({role, content, renderHint, tokenAnnotation}: {role: TranscriptRole; content: string; renderHint?: 'inline' | 'block'; tokenAnnotation?: string}): React.JSX.Element {
  const lines = content.split('\n');
  const prefix = getRolePrefix(role);
  const firstLine = lines[0] || '(empty)';
  const trailingLines = lines.slice(1);
  const isToolResult = role === 'tool' || role === 'agent';
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

function isRunningAgentTranscriptItem(item: import('../../transcript/model').TranscriptItem): item is import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta} {
  return item.role === 'agent' && item.toolMeta?.status === 'running';
}

function isCompletedAgentTranscriptItem(item: import('../../transcript/model').TranscriptItem): item is import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta} {
  return item.role === 'agent' && item.toolMeta?.status === 'done';
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

function parseSubagentRunId(itemId: string): string | undefined {
  const prefix = 'active-subagent-run:';
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : undefined;
}

function resolveSubagentRunId(
  item: import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta},
): string | undefined {
  return item.toolMeta.runId ?? parseSubagentRunId(item.id);
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

function isDurationStat(part: string): boolean {
  return /^(\d+(\.\d+)?)(ms|s|m|h)$/.test(part);
}

function formatTaskExecutionHeader(
  meta: ToolResultMeta,
  status: 'running' | 'paused' | 'done' | 'error',
  activeTask: ActiveSubagentRun | undefined,
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

function formatTaskExecutionLabel(meta: ToolResultMeta, activeTask: ActiveSubagentRun | undefined): string {
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

function SingleTaskExecutionBlock({
  item,
  activeTask,
  expanded = false,
  detailItems = [],
  subagentDetails,
}: {
  item: import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta};
  activeTask?: ActiveSubagentRun;
  expanded?: boolean;
  detailItems?: readonly import('../../transcript/model').TranscriptItem[];
  subagentDetails?: ReadonlyMap<string, import('../../transcript/model').TranscriptItem[]>;
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

  const status = activeTask?.status === 'paused'
    ? 'paused'
    : activeTask?.status === 'error'
      ? 'error'
      : activeTask?.status === 'done'
        ? 'done'
        : item.toolMeta.status;
  const summaryLine = status === 'done' || status === 'error'
    ? formatSyntheticTaskSummaryLine(activeTask, item.toolMeta.summaryLine)
    : formatSingleTaskSummaryLine(item.toolMeta, activeTask);

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold wrap="truncate-end">{formatTaskExecutionHeader(item.toolMeta, status, activeTask, frame)}</Text>
      <Text dimColor wrap="truncate-end">{`  ⎿ ${summaryLine}`}</Text>
      {expanded && detailItems.length > 0 ? (
        <Box paddingLeft={4} marginTop={1}>
          <TranscriptItemsView
            items={detailItems as import('../../transcript/model').TranscriptItem[]}
            activeSubagentRuns={[]}
            expandedAll
            subagentDetails={subagentDetails}
          />
        </Box>
      ) : null}
    </Box>
  );
}

const TASK_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const TASK_SPINNER_INTERVAL_MS = 80;

function RunningTaskGroupBlock({
  items,
  activeSubagentRuns = [],
}: {
  items: Array<import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}>;
  activeSubagentRuns?: readonly ActiveSubagentRun[];
}): React.JSX.Element {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => {
      setFrame((current) => current + 1);
    }, TASK_SPINNER_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const total = items.length;
  const activeSubagentRunsById = new Map(activeSubagentRuns.map((run) => [run.id, run]));
  const firstRunId = items[0] ? resolveSubagentRunId(items[0]) : undefined;
  const singleTask = total === 1 && firstRunId ? activeSubagentRunsById.get(firstRunId) : undefined;
  if (total === 1) {
    return (
      <SingleTaskExecutionBlock
        item={items[0]!}
        activeTask={singleTask}
      />
    );
  }
  const hasLiveTask = items.some((item) => {
    const runId = resolveSubagentRunId(item);
    const activeTask = runId ? activeSubagentRunsById.get(runId) : undefined;
    return activeTask?.status === 'running' || activeTask?.status === 'paused' || item.toolMeta.status === 'running';
  });
  const spinner = TASK_SPINNER_FRAMES[((frame % TASK_SPINNER_FRAMES.length) + TASK_SPINNER_FRAMES.length) % TASK_SPINNER_FRAMES.length];
  const headerBase = hasLiveTask ? `${spinner} Running ${total} subagents...` : `⏺ Completed ${total} subagents...`;
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold>{headerBase}</Text>
      {items.map((item, index) => {
        const rowPrefix = index === items.length - 1 ? '└─ ' : '├─ ';
        const branchPrefix = index === items.length - 1 ? '   ' : '│  ';
        const runId = resolveSubagentRunId(item);
        const activeTask = runId ? activeSubagentRunsById.get(runId) : undefined;
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

        return (
          <Box key={item.id} flexDirection="column">
            <Text wrap="truncate-end">{`${rowPrefix}${rowLabel}`}</Text>
            <Text dimColor wrap="truncate-end">
              {`${branchPrefix}⎿ ${rowSummary}`}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function projectExecutionTreeItems(
  items: import('../../transcript/model').TranscriptItem[],
  activeSubagentRuns: readonly ActiveSubagentRun[],
): import('../../transcript/model').TranscriptItem[] {
  if (activeSubagentRuns.length === 0) {
    return items;
  }

  const runsById = new Map(activeSubagentRuns.map((run) => [run.id, run]));
  return items.map((item) => {
    if (item.role !== 'agent' || !item.toolMeta) {
      return item;
    }

    const runId = resolveSubagentRunId(item as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta});
    if (!runId) {
      return item;
    }

    const activeRun = runsById.get(runId);
    if (!activeRun) {
      return item;
    }

    return buildSyntheticSubagentTranscriptItem(
      activeRun,
      item as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta},
    );
  });
}

function buildSyntheticSubagentTranscriptItem(
  run: ActiveSubagentRun,
  existing?: import('../../transcript/model').TranscriptItem & {toolMeta?: ToolResultMeta},
): import('../../transcript/model').TranscriptItem {
  const parsed = parseActiveSubagentRunName(run.name);
  const summaryLine = formatSyntheticTaskSummaryLine(run, existing?.toolMeta?.summaryLine);
  const detailLines = run.activityLog?.filter(Boolean) ?? [];

  return {
    id: existing?.id ?? `active-subagent-run:${run.id}`,
    role: 'agent',
    content: `⚙ ${parsed.displayName}${parsed.args ? `(${parsed.args})` : ''}\n${summaryLine}`,
    toolMeta: {
      toolName: existing?.toolMeta?.toolName ?? 'Agent',
      displayName: parsed.displayName,
      icon: '⚙',
      ...(parsed.args ? {args: parsed.args} : {}),
      runId: run.id,
      status: run.status === 'error' ? 'error' : run.status === 'done' ? 'done' : 'running',
      summaryLine,
      ...(detailLines.length > 0 ? {outputLines: detailLines.slice(-4)} : {}),
      ...(detailLines.length > 0 ? {allOutputLines: detailLines} : {}),
      ...(detailLines.length > 0 ? {totalOutputLines: detailLines.length} : {}),
    },
  };
}

function parseActiveSubagentRunName(name: string): {displayName: string; args?: string} {
  const colonIndex = name.indexOf(': ');
  if (colonIndex <= 0) {
    return {displayName: name.trim() || 'Agent'};
  }

  return {
    displayName: name.slice(0, colonIndex).trim() || 'Agent',
    args: name.slice(colonIndex + 2).trim() || undefined,
  };
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

/** Renders pre-filtered active (streaming) transcript items. */
export function ActiveTranscript({
  items,
  activeSubagentRuns = [],
  expandedAll = false,
  subagentDetails,
}: {
  items: import('../../transcript/model').TranscriptItem[];
  activeSubagentRuns?: readonly ActiveSubagentRun[];
  expandedAll?: boolean;
  subagentDetails?: ReadonlyMap<string, import('../../transcript/model').TranscriptItem[]>;
}): React.JSX.Element {
  return <TranscriptItemsView items={items} activeSubagentRuns={activeSubagentRuns} expandedAll={expandedAll} subagentDetails={subagentDetails} />;
}

export function TranscriptItemsView({
  items,
  activeSubagentRuns = [],
  expandedAll = false,
  subagentDetails,
}: {
  items: import('../../transcript/model').TranscriptItem[];
  activeSubagentRuns?: readonly ActiveSubagentRun[];
  expandedAll?: boolean;
  subagentDetails?: ReadonlyMap<string, import('../../transcript/model').TranscriptItem[]>;
}): React.JSX.Element {
  const projectedItems = projectExecutionTreeItems(items, activeSubagentRuns);
  const shouldGroupTaskItems = !expandedAll && projectedItems.filter((item) => item.role === 'agent' && item.toolMeta).length > 1;
  const blocks: React.JSX.Element[] = [];

  for (let index = 0; index < projectedItems.length; index += 1) {
    const item = projectedItems[index]!;
    if (shouldGroupTaskItems && item.role === 'agent' && item.toolMeta) {
      const groupedItems = [item as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta}];
      let cursor = index + 1;
      while (cursor < projectedItems.length && projectedItems[cursor]!.role === 'agent' && projectedItems[cursor]!.toolMeta) {
        groupedItems.push(projectedItems[cursor]! as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta});
        cursor += 1;
      }

      blocks.push(
        <RunningTaskGroupBlock
          key={item.id}
          items={groupedItems}
          activeSubagentRuns={activeSubagentRuns}
        />,
      );
      index = cursor - 1;
      continue;
    }

    if (!expandedAll && isRunningAgentTranscriptItem(item)) {
      const groupedItems = [item];
      let cursor = index + 1;
      while (cursor < projectedItems.length && isRunningAgentTranscriptItem(projectedItems[cursor]!)) {
        groupedItems.push(projectedItems[cursor]! as import('../../transcript/model').TranscriptItem & {toolMeta: ToolResultMeta});
        cursor += 1;
      }

      blocks.push(
        <RunningTaskGroupBlock
          key={item.id}
          items={groupedItems}
          activeSubagentRuns={activeSubagentRuns}
        />,
      );
      index = cursor - 1;
      continue;
    }

    if (isCompletedAgentTranscriptItem(item)) {
      const runId = resolveSubagentRunId(item);
      blocks.push(
        <SingleTaskExecutionBlock
          key={item.id}
          item={item}
          expanded={expandedAll}
          detailItems={runId ? subagentDetails?.get(runId) : undefined}
          subagentDetails={subagentDetails}
        />,
      );
      continue;
    }

    if (isRunningAgentTranscriptItem(item) && expandedAll) {
      const runId = resolveSubagentRunId(item);
      const activeTask = runId ? activeSubagentRuns.find((run) => run.id === runId) : undefined;
      blocks.push(
        <SingleTaskExecutionBlock
          key={item.id}
          item={item}
          activeTask={activeTask}
          expanded={expandedAll}
          detailItems={runId ? subagentDetails?.get(runId) : undefined}
          subagentDetails={subagentDetails}
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

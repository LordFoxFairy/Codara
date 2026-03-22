import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@/index';
import {parseAskUserResult} from '@core/middleware';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {readMessageText} from '@shared/messages';
import {readDelegatedAgentResult} from '@shared/delegation-result';
import {readAgentRunLaunchResult} from '@shared/agent-run-launch';
import {readSharedTaskCoordinationArtifact} from '@shared/task-coordination-result';
import {TOOL_NAMES} from '@shared/tool-display';
import {formatSubagentDisplayName, normalizeSubagentType} from '@context/skills/runtime-shared';
import type {CliActiveTurn, CliNotice} from '../app/view-state';
import {isInvalidTaskCloseoutResponse} from '../task-closeout';
import {formatTokenCount} from '../utils/format';
import {computeEditDiff, type DiffData} from './diff-compute';

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'tool' | 'task' | 'review' | 'command' | 'error';

export interface SolidifiedItem {
  id: string;
  kind: 'welcome' | 'notice' | 'turn';
  items: TranscriptItem[];
}

export interface ToolResultMeta {
  toolName: string;
  displayName: string;
  icon: string;
  args?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: string;
  summaryLine: string;
  outputLines?: string[];
  allOutputLines?: string[];
  totalOutputLines?: number;
  diffData?: DiffData;
}

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  content: string;
  /** Rendering hint: 'inline' for single-line, 'block' for multi-line with left border */
  renderHint?: 'inline' | 'block';
  /** Structured tool result metadata for enhanced rendering */
  toolMeta?: ToolResultMeta;
  /** Token usage annotation for this turn (e.g. "↓12.3k ↑2.1k") */
  tokenAnnotation?: string;
}

export interface BuildTranscriptItemsInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  nowTimestamp?: string;
  limit?: number;
  preserveVisibleAssistantTexts?: ReadonlySet<string>;
}

export interface HasTranscriptContentInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  initialNoticeCount?: number;
}

export const DEFAULT_TRANSCRIPT_LIMIT = 20;

export function dedupeTrailingTranscriptItemsCoveredByRuntime(
  trailingItems: readonly TranscriptItem[],
  runtimeItems: readonly TranscriptItem[],
): TranscriptItem[] {
  const runtimeFingerprints = new Set(
    runtimeItems
      .map(buildRuntimeCoverageFingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
  );

  if (runtimeFingerprints.size === 0) {
    return [...trailingItems];
  }

  return trailingItems.filter((item) => {
    const fingerprint = buildRuntimeCoverageFingerprint(item);
    return !fingerprint || !runtimeFingerprints.has(fingerprint);
  });
}

export function buildTranscriptItems(input: BuildTranscriptItemsInput): TranscriptItem[] {
  const toolLookup = createToolCallLookup(input.coreMessages);
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0 && input.activeTurn !== undefined;
  const suppressActiveTurnResponse = shouldSuppressAssistantTaskLaunchChatter(
    input.activeTurn?.response,
    input.activeTurn?.responseRole,
    input.runtimeEvents,
    input.activeTurn?.pendingTaskLaunch,
    input.activeTurn?.suppressTaskLaunchResponse,
  );
  const items = [
    ...input.notices.map((notice) => ({
      id: notice.id,
      role: notice.level,
      content: notice.content,
    })),
    ...input.coreMessages.flatMap((message, index) => buildCoreMessageItems(
      message,
      index,
      input.coreMessages,
      toolLookup,
      preferRuntimeSteps,
      input.preserveVisibleAssistantTexts,
    )),
    ...(input.activeTurn
      ? [
          {
            id: `${input.activeTurn.id}-prompt`,
            role: 'user' as const,
            content: input.activeTurn.prompt,
          },
          {
            id: `${input.activeTurn.id}-response`,
            role: input.activeTurn.responseRole,
            content: suppressActiveTurnResponse ? '' : input.activeTurn.response,
          },
        ]
      : []),
    ...(preferRuntimeSteps ? buildRuntimeEventItems(input.runtimeEvents ?? [], input.nowTimestamp) : []),
  ];

  return items
    .filter((item) => item.content)
    .slice(-(input.limit ?? DEFAULT_TRANSCRIPT_LIMIT));
}

/**
 * Build transcript items from a range of coreMessages (for solidified/completed turns).
 * No limit, no activeTurn, no runtimeEvents — just finalized messages.
 */
export function buildSolidifiedItemsFromRange(
  coreMessages: readonly BaseMessage[],
  startIndex: number,
  endIndex: number,
  toolLookup: Map<string, ToolCall>,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const message = coreMessages[i];
    if (!message) continue;
    items.push(...buildCoreMessageItems(message, i, coreMessages, toolLookup, false, preserveVisibleAssistantTexts));
  }
  return items.filter((item) => item.content);
}

/**
 * Build transcript items for the active (streaming) portion — activeTurn + runtimeEvents only.
 */
export function buildActiveItems(input: {
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  nowTimestamp?: string;
}): TranscriptItem[] {
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0;
  const suppressInternalInteractionResponse = shouldSuppressActiveTurnInteractionPreamble(
    input.activeTurn?.responseRole,
    input.runtimeEvents,
  );
  const suppressActiveTurnResponse = shouldSuppressAssistantTaskLaunchChatter(
    input.activeTurn?.response,
    input.activeTurn?.responseRole,
    input.runtimeEvents,
    input.activeTurn?.pendingTaskLaunch,
    input.activeTurn?.suppressTaskLaunchResponse,
  );
  const thinkingItem = input.activeTurn?.thinking
    ? [{
        id: `${input.activeTurn.id}-thinking`,
        role: 'system' as const,
        content: `💭 Thinking…\n${input.activeTurn.thinking.slice(-200)}`,
      }]
    : [];
  const runtimeItems = preferRuntimeSteps ? buildRuntimeEventItems(input.runtimeEvents ?? [], input.nowTimestamp) : [];
  const promptAndResponseItems: TranscriptItem[] = [];
  if (input.activeTurn) {
    promptAndResponseItems.push({
      id: `${input.activeTurn.id}-prompt`,
      role: 'user' as const,
      content: input.activeTurn.prompt,
    });
    promptAndResponseItems.push(...thinkingItem);
  }

  const preRuntimeAssistantItems: TranscriptItem[] = input.activeTurn?.responseBeforeRuntime
    && !suppressActiveTurnResponse
    && !suppressInternalInteractionResponse
    && !input.activeTurn?.suppressInteractionResponse
    ? [{
        id: `${input.activeTurn.id}-response-before-runtime`,
        role: input.activeTurn.responseRole,
        content: input.activeTurn.responseBeforeRuntime,
      }]
    : [];
  const currentAssistantItems: TranscriptItem[] = input.activeTurn
    ? [{
        id: `${input.activeTurn.id}-response`,
        role: input.activeTurn.responseRole,
        content: suppressActiveTurnResponse || suppressInternalInteractionResponse || input.activeTurn.suppressInteractionResponse
          ? ''
          : input.activeTurn.response,
      }]
    : [];
  const items: TranscriptItem[] = input.activeTurn?.kind === 'task_completion'
    ? [...runtimeItems, ...promptAndResponseItems, ...currentAssistantItems]
    : preRuntimeAssistantItems.length > 0
      ? [...promptAndResponseItems, ...preRuntimeAssistantItems, ...runtimeItems, ...currentAssistantItems]
      : [...promptAndResponseItems, ...currentAssistantItems, ...runtimeItems];
  return items.filter((item) => item.content);
}

/**
 * Create a tool-call lookup from all messages. Exposed for use by solidified transcript hook.
 */
export {createToolCallLookup};

export function hasTranscriptContent(input: HasTranscriptContentInput): boolean {
  if (input.activeTurn) {
    return true;
  }

  if ((input.runtimeEvents?.length ?? 0) > 0) {
    return true;
  }

  if (input.notices.length > (input.initialNoticeCount ?? 0)) {
    return true;
  }

  return input.coreMessages.some((message) => {
    const text = readMessageText(message);
    return Boolean(text && (
      HumanMessage.isInstance(message)
      || AIMessage.isInstance(message)
      || ToolMessage.isInstance(message)
      || SystemMessage.isInstance(message)
    ));
  });
}

const MAX_CHILD_ACTIVITY_LINES = 3;
const TODO_TOOL_NAME = 'write_todos';

function shouldSuppressAssistantTaskLaunchChatter(
  response: string | undefined,
  role: TranscriptRole | undefined,
  runtimeEvents: readonly CodaraRuntimeEvent[] | undefined,
  pendingTaskLaunch: boolean | undefined = false,
  suppressTaskLaunchResponse: boolean | undefined = false,
): boolean {
  if (role !== 'assistant') {
    return false;
  }

  const text = response?.trim();
  if (!text) {
    return false;
  }

  if (pendingTaskLaunch && (suppressTaskLaunchResponse || containsTaskLaunchChatter(text))) {
    return true;
  }

  const hasLiveAgentRuntime = (runtimeEvents ?? []).some((event) => (
    event.kind === 'task'
    && ((event.phase === 'start' && event.status === 'running') || (event.phase === 'update' && event.status === 'paused'))
  ));

  if (!hasLiveAgentRuntime) {
    return false;
  }

  return containsTaskLaunchChatter(text);
}

function shouldSuppressSolidifiedTaskLaunchChatter(
  message: AIMessage,
  previousMessage: BaseMessage | undefined,
  toolLookup: Map<string, ToolCall>,
): boolean {
  const text = readMessageText(message);
  if (!text) {
    return false;
  }

  if (messageContainsTaskToolCall(message)) {
    return true;
  }

  if (!ToolMessage.isInstance(previousMessage)) {
    return false;
  }

  const previousToolName = resolveToolMessageName(previousMessage, toolLookup);
  if (!isAgentToolName(previousToolName) || !readAgentRunLaunchResult(previousMessage.artifact)) {
    return false;
  }

  return shouldSuppressAssistantTaskLaunchChatter(text, 'assistant', [{
    id: 'task-launch',
    sessionId: 'task-launch',
    timestamp: new Date(0).toISOString(),
    kind: 'task',
    phase: 'start',
    status: 'running',
    label: 'Delegating Agent',
  }]);
}

function buildRuntimeEventItems(events: readonly CodaraRuntimeEvent[], nowTimestamp?: string): TranscriptItem[] {
  const startEvents = new Map<string, CodaraRuntimeEvent>();
  const pairedEndIds = new Set<string>();
  const taskToolIds = new Set<string>();
  /** Child tool activity events grouped by parent task ID. */
  const taskChildActivity = new Map<string, CodaraRuntimeEvent[]>();
  const items: TranscriptItem[] = [];
  // Prefix IDs to avoid collisions with solidified transcript items
  // (runtime events share IDs with coreMessages that may already be rendered)
  const activeId = (id: string) => `active-${id}`;

  // First pass: index start events by id, identify Agent tool calls, collect child activity
  for (const event of events) {
    if (event.phase === 'start') {
      startEvents.set(event.id, event);
    }
    // Task events have a parentId pointing to their parent tool event — mark those tool events
    if (event.kind === 'task' && event.phase === 'start' && event.parentId) {
      taskToolIds.add(event.parentId);
    }
    // Collect child tool activity events (task:update from ActivityForwardMiddleware)
    if (event.kind === 'task' && event.phase === 'update' && event.parentId && event.detail) {
      const activities = taskChildActivity.get(event.parentId) ?? [];
      activities.push(event);
      taskChildActivity.set(event.parentId, activities);
    }
  }

  const runtimeTaskLabels = new Set(
    Array.from(startEvents.values())
      .filter((event) => event.kind === 'task' && event.phase === 'start' && !event.parentId)
      .map((event) => event.label),
  );

  // Second pass: pair end events with start events, build items
  const pairedTaskEnds: Array<{startEvent: CodaraRuntimeEvent; endEvent: CodaraRuntimeEvent}> = [];
  for (const event of events) {
    if (event.kind === 'turn' || event.kind === 'model' || shouldHideRuntimeEventForTranscript(event)) {
      continue;
    }

    // Skip tool events that are the parent of a task event (task rendering replaces them)
    if (event.kind === 'tool' && event.phase === 'end' && event.parentId && taskToolIds.has(event.parentId)) {
      pairedEndIds.add(event.id);
      continue;
    }

    // Task update events (child activity) — handled in the running task rendering, skip here
    if (event.kind === 'task' && event.phase === 'update' && event.parentId && taskChildActivity.has(event.parentId)) {
      continue;
    }

    // Task end event — pair with start, render like tool call
    if (event.kind === 'task' && event.phase === 'end' && event.parentId) {
      const startEvent = startEvents.get(event.parentId);
      if (startEvent) {
        pairedEndIds.add(event.id);
        if (isPendingTaskPlaceholderStart(startEvent)) {
          continue;
        }
        if (!isRunIdBackedTaskStart(startEvent)) {
          continue;
        }
        if (isSyntheticTaskStart(startEvent, startEvents) && runtimeTaskLabels.has(startEvent.label)) {
          continue;
        }
        pairedTaskEnds.push({startEvent, endEvent: event});
        continue;
      }
    }

    // Tool end event — pair with start
    if (event.kind === 'tool' && event.phase === 'end' && event.parentId) {
      const startEvent = startEvents.get(event.parentId);
      if (startEvent) {
        const rawToolName = (startEvent.detail ?? '').trim();
        if (isInteractionToolName(rawToolName)) {
          pairedEndIds.add(event.id);
          continue;
        }
        if (rawToolName === TODO_TOOL_NAME) {
          pairedEndIds.add(event.id);
          continue;
        }
        if (isRepeatedAskUserContinuationNotice(event.detail)) {
          pairedEndIds.add(event.id);
          continue;
        }
        pairedEndIds.add(event.id);
        const toolMeta = buildToolMetaFromEvents(rawToolName, startEvent, event);
        const content = toolMeta
          ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
          : formatRuntimeEvent(event);
        items.push({
          id: activeId(startEvent.id),
          role: mapRuntimeEventRole(event.kind),
          content,
          toolMeta: toolMeta ?? undefined,
        });
        continue;
      }
    }

    // Skip start events that have been paired.
    if (event.phase === 'start' && (event.kind === 'tool' || event.kind === 'task')) {
      continue;
    }

    items.push({
      id: activeId(event.id),
      role: mapRuntimeEventRole(event.kind),
      content: formatRuntimeEvent(event),
    });
  }

  // Render completed tasks via ToolResultBlock (same visual as tool calls)
  for (const {startEvent, endEvent} of pairedTaskEnds) {
    const agentType = extractSubagentType(startEvent.label);
    const elapsed = formatElapsed(startEvent.timestamp, endEvent.timestamp);
    const status = endEvent.status === 'error' ? 'error' : 'done';
    const elapsedSec = computeElapsedSeconds(startEvent.timestamp, endEvent.timestamp);
    const childActivities = taskChildActivity.get(startEvent.id) ?? [];
    const toolActivityLabels = childActivities
      .filter((activity) => !isTaskLifecycleUpdate(activity.label))
      .map((activity) => activity.label);
    const summary = endEvent.status === 'error'
      ? `Failed (${elapsedSec}s)`
      : endEvent.status === 'paused'
        ? 'Waiting for review'
        : formatTaskDoneSummary(elapsedSec, endEvent.detail);
    const taskOutput = toolActivityLabels.length > 0
      ? buildTaskActivityOutput(toolActivityLabels)
      : {outputLines: undefined, allOutputLines: undefined, totalOutputLines: 0};
    items.push({
      id: activeId(startEvent.id),
      role: 'task',
      content: `⚙ ${agentType}(${extractTaskArgs(startEvent.label)})\n${summary}`,
      toolMeta: {
        toolName: TOOL_NAMES.AGENT,
        displayName: agentType,
        icon: '⚙',
        args: extractTaskArgs(startEvent.label),
        status: status as 'done' | 'error',
        elapsed,
        summaryLine: summary,
        ...(taskOutput.outputLines ? {outputLines: taskOutput.outputLines} : {}),
        ...(taskOutput.allOutputLines ? {allOutputLines: taskOutput.allOutputLines} : {}),
        ...(typeof taskOutput.totalOutputLines === 'number' ? {totalOutputLines: taskOutput.totalOutputLines} : {}),
      },
    });
  }

  // Third pass: show unpaired start events as "running"
  const unpairedTaskStarts: Array<{id: string; startEvent: CodaraRuntimeEvent}> = [];
  for (const [id, startEvent] of startEvents) {
    if (shouldHideRuntimeEventForTranscript(startEvent)) {
      continue;
    }
    const wasPaired = events.some(
      (e) => e.phase === 'end' && e.parentId === id && (e.kind === 'tool' || e.kind === 'task'),
    );
    if (wasPaired) {
      continue;
    }

    // Unpaired task start → collected below for grouped rendering
    if (startEvent.kind === 'task') {
      if (isPendingTaskPlaceholderStart(startEvent)) {
        continue;
      }
      if (!isRunIdBackedTaskStart(startEvent)) {
        continue;
      }
      if (isSyntheticTaskStart(startEvent, startEvents) && runtimeTaskLabels.has(startEvent.label)) {
        continue;
      }
      unpairedTaskStarts.push({id, startEvent});
      continue;
    }

    // Unpaired tool start → skip if it's the parent of a running task (task rendering replaces it)
    if (startEvent.kind === 'tool' && taskToolIds.has(id)) {
      continue;
    }

    if (startEvent.kind === 'tool') {
      const rawToolName = startEvent.detail ?? '';
      const toolMeta = buildToolMetaRunning(rawToolName, startEvent);
      const content = toolMeta
        ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
        : formatRuntimeEvent(startEvent);
      items.push({
        id: activeId(startEvent.id),
        role: 'tool',
        content,
        toolMeta: toolMeta ?? undefined,
      });
    }
  }

  // Render running tasks via ToolResultBlock (same visual as tool calls)
  for (const {id: taskId, startEvent} of unpairedTaskStarts) {
    const agentType = extractSubagentType(startEvent.label);
    const childActivities = taskChildActivity.get(taskId) ?? [];
    const runningDisplay = buildRunningTaskDisplay(startEvent, childActivities, nowTimestamp);
    items.push({
      id: activeId(taskId),
      role: 'task',
      content: `⚙ ${agentType}(${extractTaskArgs(startEvent.label)})\n${runningDisplay.summaryLine}`,
      toolMeta: {
        toolName: TOOL_NAMES.AGENT,
        displayName: agentType,
        icon: '⚙',
        args: extractTaskArgs(startEvent.label),
        status: 'running',
        ...(runningDisplay.elapsed ? {elapsed: runningDisplay.elapsed} : {}),
        summaryLine: runningDisplay.summaryLine,
        ...(runningDisplay.outputLines ? {outputLines: runningDisplay.outputLines} : {}),
        ...(runningDisplay.allOutputLines ? {allOutputLines: runningDisplay.allOutputLines} : {}),
        ...(typeof runningDisplay.totalOutputLines === 'number' ? {totalOutputLines: runningDisplay.totalOutputLines} : {}),
      },
    });
  }

  return items;
}

function isSyntheticTaskStart(
  startEvent: CodaraRuntimeEvent,
  startEvents: ReadonlyMap<string, CodaraRuntimeEvent>,
): boolean {
  if (startEvent.kind !== 'task' || startEvent.phase !== 'start' || !startEvent.parentId) {
    return false;
  }

  return startEvents.get(startEvent.parentId)?.kind === 'tool';
}

function isPendingTaskPlaceholderStart(startEvent: CodaraRuntimeEvent): boolean {
  return startEvent.kind === 'task'
    && startEvent.phase === 'start'
    && startEvent.detail === 'pending';
}

function isRunIdBackedTaskStart(startEvent: CodaraRuntimeEvent): boolean {
  return startEvent.kind === 'task'
    && startEvent.phase === 'start'
    && startEvent.id.startsWith('agent-run:');
}

function buildRunningTaskDisplay(
  startEvent: CodaraRuntimeEvent,
  activities: CodaraRuntimeEvent[],
  nowTimestamp?: string,
): {
  summaryLine: string;
  elapsed?: string;
  outputLines?: string[];
  allOutputLines?: string[];
  totalOutputLines?: number;
} {
  const lifecycleUpdate = [...activities].reverse().find((activity) => isTaskLifecycleUpdate(activity.label));
  const toolActivities = activities.filter((activity) => !isTaskLifecycleUpdate(activity.label));
  const activityLabels = toolActivities.map((activity) => activity.label);
  const recentLabels = activityLabels.slice(-MAX_CHILD_ACTIVITY_LINES);
  const latestTimestamp = activities[activities.length - 1]?.timestamp ?? nowTimestamp ?? startEvent.timestamp;
  const elapsed = formatElapsed(startEvent.timestamp, latestTimestamp);
  const statusLabel = lifecycleUpdate?.label === 'Subagent waiting for review'
    ? 'Waiting for review'
    : 'Running';
  const statParts = [`${elapsed}`];
  if (toolActivities.length > 0) {
    statParts.push(`${toolActivities.length} tool activit${toolActivities.length === 1 ? 'y' : 'ies'}`);
  }

  return {
    summaryLine: `${statusLabel} (${statParts.join(' · ')})`,
    elapsed,
    ...(recentLabels.length > 0 ? {outputLines: recentLabels} : {}),
    ...(activityLabels.length > 0 ? {allOutputLines: activityLabels} : {}),
    ...(activityLabels.length > 0 ? {totalOutputLines: activityLabels.length} : {}),
  };
}

function buildTaskActivityOutput(activityLabels: string[]): {
  outputLines?: string[];
  allOutputLines?: string[];
  totalOutputLines?: number;
} {
  const visible = activityLabels.slice(-MAX_CHILD_ACTIVITY_LINES);
  return {
    ...(visible.length > 0 ? {outputLines: visible} : {}),
    ...(activityLabels.length > 0 ? {allOutputLines: activityLabels} : {}),
    ...(activityLabels.length > 0 ? {totalOutputLines: activityLabels.length} : {}),
  };
}

function isTaskLifecycleUpdate(label: string): boolean {
  return label.startsWith('Subagent ');
}

function extractSubagentType(label: string): string {
  // "Delegating Plan: some description" → "Plan"
  const match = label.match(/^Delegating\s+([\w-]+)/);
  if (!match) return 'Task';
  return formatSubagentDisplayName(match[1]!);
}

/** Extract just the description (without agent type prefix) for toolMeta.args. */
function extractTaskArgs(label: string): string {
  const firstLine = label.split('\n')[0]!.trim();
  const text = firstLine.startsWith('Delegating ') ? firstLine.slice('Delegating '.length) : firstLine;
  const colonIndex = text.indexOf(': ');
  const desc = colonIndex > 0 ? text.slice(colonIndex + 2) : text;
  return desc.length > 50 ? `${desc.slice(0, 47)}…` : desc;
}


function computeElapsedSeconds(startTimestamp: string, endTimestamp: string): number {
  const start = new Date(startTimestamp).getTime();
  const end = new Date(endTimestamp).getTime();
  return Math.round((end - start) / 1000);
}

function formatTaskDoneSummary(elapsed: number, detail?: string): string {
  const parts: string[] = [];
  // Parse stats from detail (format: "summary\nN tool uses · Xk tokens")
  if (detail) {
    const toolUseMatch = detail.match(/(\d+)\s+tool uses?/);
    const tokenMatch = detail.match(/([\d.]+[kKmM]?)\s+tokens?/);
    if (toolUseMatch) parts.push(`${toolUseMatch[1]} tool uses`);
    if (tokenMatch) parts.push(`${tokenMatch[1]} tokens`);
  }
  parts.push(`${elapsed}s`);
  return `Done (${parts.join(' · ')})`;
}

function formatElapsed(startTimestamp: string, endTimestamp: string): string {
  const ms = new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  if (ms < 1000) {
    return `${Math.max(0, ms)}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

const TOOL_META_MAX_LINES = 4;

function buildToolMetaFromEvents(
  rawToolName: string,
  startEvent: CodaraRuntimeEvent,
  endEvent: CodaraRuntimeEvent,
): ToolResultMeta | undefined {
  if (!rawToolName) {
    return undefined;
  }

  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);
  const status = endEvent.status === 'error' ? 'error' : 'done';
  const {summaryLine, outputLines, allOutputLines, totalOutputLines} = buildToolOutput(rawToolName, status, endEvent.detail);

  const elapsed = formatElapsed(startEvent.timestamp, endEvent.timestamp);

  return {toolName: rawToolName, displayName, icon, args, status, elapsed, summaryLine, outputLines, allOutputLines, totalOutputLines};
}

function buildToolMetaRunning(rawToolName: string, startEvent: CodaraRuntimeEvent): ToolResultMeta | undefined {
  if (!rawToolName) {
    return undefined;
  }

  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const args = parseToolCallArgs(startEvent.label);

  return {toolName: rawToolName, displayName, icon, args, status: 'running', summaryLine: '…'};
}

function parseToolCallArgs(label: string): string | undefined {
  const match = label.match(/^[^(]+\((.+)\)$/s);
  return match?.[1]?.trim() || undefined;
}

function buildToolOutput(
  toolName: string,
  status: 'done' | 'error',
  detail?: string,
): {summaryLine: string; outputLines?: string[]; allOutputLines?: string[]; totalOutputLines?: number} {
  if (status === 'error') {
    const lines = truncateOutput(detail);
    return {
      summaryLine: 'Error',
      outputLines: lines.visible,
      allOutputLines: lines.all,
      totalOutputLines: lines.total,
    };
  }

  const trimmed = detail?.trim() ?? '';
  switch (toolName) {
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE: {
      const lines = truncateOutput(trimmed);
      const lineCount = lines.total;
      const fileMatch = trimmed.match(/^Wrote \d+ lines? to (.+)/);
      const summaryLine = fileMatch
        ? `Wrote ${lineCount} lines to ${fileMatch[1]}`
        : `Wrote ${lineCount} lines`;
      return {summaryLine, outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT: {
      const lines = truncateOutput(trimmed);
      return {summaryLine: buildEditSummary(trimmed), outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case TOOL_NAMES.BASH: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
    case TOOL_NAMES.AGENT: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const taskLines = trimmed.split('\n');
      return {summaryLine: taskLines[0] ?? 'Done', outputLines: taskLines.slice(1), allOutputLines: taskLines.slice(1), totalOutputLines: taskLines.length};
    }
    default: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
  }
}

function buildEditSummary(detail: string): string {
  const lines = detail.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }
  if (added === 0 && removed === 0) {
    return 'Edited';
  }
  const parts: string[] = [];
  if (added > 0) {
    parts.push(`Added ${added} line${added === 1 ? '' : 's'}`);
  }
  if (removed > 0) {
    parts.push(`removed ${removed} line${removed === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function truncateOutput(detail?: string, maxLines: number = TOOL_META_MAX_LINES): {visible: string[]; all: string[]; total: number} {
  if (!detail?.trim()) {
    return {visible: [], all: [], total: 0};
  }
  const allLines = detail.trim().split('\n');
  const total = allLines.length;
  const visible = allLines.slice(0, maxLines);
  return {visible, all: allLines, total};
}

function mapRuntimeEventRole(kind: CodaraRuntimeEvent['kind']): TranscriptRole {
  switch (kind) {
    case 'task':
      return 'task';
    case 'hil':
      return 'review';
    case 'command':
    case 'summary':
      return 'command';
    case 'tool':
      return 'tool';
    default:
      return 'system';
  }
}

function formatRuntimeEvent(event: CodaraRuntimeEvent): string {
  if (event.kind === 'tool' || event.kind === 'task') {
    if (event.phase === 'end') {
      if (event.status === 'done' && event.detail?.trim()) {
        return event.detail.trim();
      }

      if (event.status === 'paused' || event.status === 'error') {
        return [event.label, event.detail].filter(Boolean).join('\n');
      }

      return event.label.trim();
    }

    return [event.label, event.detail].filter(Boolean).join('\n');
  }

  return [event.label, event.detail].filter(Boolean).join('\n');
}

function mapCoreMessageRole(message: BaseMessage): TranscriptRole {
  if (HumanMessage.isInstance(message)) {
    return 'user';
  }

  if (AIMessage.isInstance(message)) {
    return 'assistant';
  }

  if (ToolMessage.isInstance(message)) {
    return 'tool';
  }

  return 'system';
}

function buildCoreMessageItems(
  message: BaseMessage,
  index: number,
  allMessages: readonly BaseMessage[],
  toolLookup: Map<string, ToolCall>,
  preferRuntimeSteps: boolean,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
): TranscriptItem[] {
  const messageId = String(message.id ?? `${message.type}-${index}`);

  if (AIMessage.isInstance(message)) {
    const previousMessage = index > 0 ? allMessages[index - 1] : undefined;
    const nextMessage = index < allMessages.length - 1 ? allMessages[index + 1] : undefined;
    return buildAssistantItems(message, messageId, previousMessage, nextMessage, toolLookup, preserveVisibleAssistantTexts);
  }

  if (ToolMessage.isInstance(message)) {
    if (preferRuntimeSteps) {
      return [];
    }
    return buildToolResultItems(message, messageId, toolLookup);
  }

  const text = readMessageText(message);
  return text ? [{
    id: messageId,
    role: mapCoreMessageRole(message),
    content: text,
  }] : [];
}

function buildAssistantItems(
  message: AIMessage,
  messageId: string,
  previousMessage: BaseMessage | undefined,
  nextMessage: BaseMessage | undefined,
  toolLookup: Map<string, ToolCall>,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const text = readMessageText(message);
  if (text && containsHiddenInteractionToolCall(message)) {
    return items;
  }
  const preserveVisibleText = text ? preserveVisibleAssistantTexts?.has(normalizeVisibleAssistantText(text)) ?? false : false;
  if (
    text
    && (preserveVisibleText || (
      !shouldSuppressSolidifiedTaskLaunchChatter(message, previousMessage, toolLookup)
      && !shouldSuppressSupersededTaskCloseout(message, nextMessage)
    ))
  ) {
    items.push({
      id: messageId,
      role: 'assistant',
      content: text,
      tokenAnnotation: readTokenAnnotation(message),
    });
  }

  // Tool calls are rendered via ToolMessage results (buildToolResultItems)
  // or via runtime events during streaming — no need to show them separately here.
  return items;
}

function containsTaskLaunchChatter(text: string): boolean {
  const launchChatterSignals = [
    '任务已启动',
    '委派信息',
    '正在等待 subagent',
    'subagent 已启动',
    '我已使用 Agent 工具委派',
    'I used the Agent tool',
    'Subagent started',
    'waiting for the subagent',
  ];

  return launchChatterSignals.some((signal) => text.includes(signal));
}

function messageContainsTaskToolCall(message: AIMessage): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.some((toolCall) => isAgentToolName(toolCall?.name));
}

export function normalizeVisibleAssistantText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function shouldSuppressSupersededTaskCloseout(
  message: AIMessage,
  nextMessage: BaseMessage | undefined,
): boolean {
  if (!nextMessage || !AIMessage.isInstance(nextMessage)) {
    return false;
  }

  const text = readMessageText(message);
  if (!text) {
    return false;
  }

  return isInvalidTaskCloseoutResponse(text);
}

function readTokenAnnotation(message: AIMessage): string | undefined {
  const meta = message.usage_metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  const input = (typeof meta.input_tokens === 'number' ? meta.input_tokens : 0)
    || (typeof meta.prompt_tokens === 'number' ? meta.prompt_tokens : 0);
  const output = (typeof meta.output_tokens === 'number' ? meta.output_tokens : 0)
    || (typeof meta.completion_tokens === 'number' ? meta.completion_tokens : 0);

  if (input === 0 && output === 0) return undefined;

  return `↓${formatTokenCount(input)} ↑${formatTokenCount(output)}`;
}

function buildToolResultItems(
  message: ToolMessage,
  messageId: string,
  toolLookup: Map<string, ToolCall>,
): TranscriptItem[] {
  if (shouldHideInternalToolMessage(message)) {
    return [];
  }

  const hilPayload = parseHILToolMessagePayload(message.content);
  if (hilPayload?.type === 'hil_pause') {
    return [];
  }
  if (hilPayload?.type === 'hil_deny') {
    return [{
      id: messageId,
      role: 'error',
      content: hilPayload.reason,
    }];
  }

  const text = readMessageText(message);
  if (!text) {
    return [];
  }
  if (isRepeatedAskUserContinuationNotice(text)) {
    return [];
  }

  const resolvedName = resolveToolMessageName(message, toolLookup);
  if (isHiddenTranscriptToolName(resolvedName)) {
    return [];
  }
  if (isInteractionToolName(resolvedName) || parseAskUserResult(text)) {
    return [];
  }
  if (resolvedName === TOOL_NAMES.AGENT && readAgentRunLaunchResult(message.artifact)) {
    return [];
  }
  if (readSharedTaskCoordinationArtifact(message.artifact)) {
    return [];
  }
  if (resolvedName === TODO_TOOL_NAME) {
    return [];
  }
  if (resolvedName === TOOL_NAMES.AGENT) {
    const taskMeta = buildTaskToolMetaFromCoreMessage(message, toolLookup);
    if (!taskMeta) {
      return [];
    }

    return [{
      id: messageId,
      role: 'task',
      content: `${taskMeta.icon} ${taskMeta.displayName}(${taskMeta.args ?? ''})\n${taskMeta.summaryLine}`,
      toolMeta: taskMeta,
    }];
  }
  const role: TranscriptRole = 'tool';
  const formattedContent = text;
  const lineCount = formattedContent.split('\n').length;

  // Build toolMeta for non-task tool results
  const toolMeta = resolvedName && !isAgentToolName(resolvedName)
    ? buildToolMetaFromCoreMessage(resolvedName, message, toolLookup, text)
    : undefined;

  return [{
    id: messageId,
    role,
    content: toolMeta
      ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
      : formattedContent,
    renderHint: lineCount > 3 ? 'block' : 'inline',
    toolMeta,
  }];
}

function buildToolMetaFromCoreMessage(
  rawToolName: string,
  message: ToolMessage,
  toolLookup: Map<string, ToolCall>,
  text: string,
): ToolResultMeta {
  const icon = toolIcon(rawToolName);
  const displayName = formatToolDisplayName(rawToolName);
  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  const toolCall = toolCallId ? toolLookup.get(toolCallId) : undefined;
  const args = toolCall ? formatFriendlyToolSummary(rawToolName, toolCall.args) : undefined;
  const status = message.status === 'error' ? 'error' : 'done';
  const {summaryLine, outputLines, allOutputLines, totalOutputLines} = buildToolOutput(rawToolName, status as 'done' | 'error', text);

  // Compute diff data for edit/write tools when tool args are available
  const diffData = toolCall ? tryComputeDiff(rawToolName, toolCall.args) : undefined;

  return {toolName: rawToolName, displayName, icon, args, status: status as 'done' | 'error', summaryLine, outputLines, allOutputLines, totalOutputLines, diffData};
}

function buildTaskToolMetaFromCoreMessage(
  message: ToolMessage,
  toolLookup: Map<string, ToolCall>,
): ToolResultMeta | undefined {
  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  const toolCall = toolCallId ? toolLookup.get(toolCallId) : undefined;
  const displayName = formatTaskToolAgentName(toolCall);
  const args = formatTaskToolPrompt(toolCall);
  const delegated = readDelegatedAgentResult(message.artifact);

  if (delegated) {
    const parts: string[] = [];
    if (typeof delegated.toolUseCount === 'number' && delegated.toolUseCount > 0) {
      parts.push(`${delegated.toolUseCount} tool uses`);
    }
    if (typeof delegated.totalTokens === 'number' && delegated.totalTokens > 0) {
      parts.push(`${formatTokenCount(delegated.totalTokens)} tokens`);
    }
    const summaryLine = delegated.reason === 'error'
      ? parts.length > 0 ? `Failed (${parts.join(' · ')})` : 'Failed'
      : parts.length > 0 ? `Done (${parts.join(' · ')})` : 'Done';
    return {
      toolName: TOOL_NAMES.AGENT,
      displayName,
      icon: '⚙',
      args,
      status: delegated.reason === 'error' ? 'error' : 'done',
      summaryLine,
    };
  }

  const fallbackText = readMessageText(message)?.trim();
  if (!fallbackText) {
    return undefined;
  }

  return {
    toolName: TOOL_NAMES.AGENT,
    displayName,
    icon: '⚙',
    args,
    status: message.status === 'error' ? 'error' : 'done',
    summaryLine: message.status === 'error' ? 'Failed' : 'Done',
  };
}

function formatTaskToolAgentName(toolCall: ToolCall | undefined): string {
  const subagentType = normalizeSubagentType(readTaskToolArg(toolCall?.args, 'subagent_type'));
  if (!subagentType) {
    return 'Agent';
  }
  return formatSubagentDisplayName(subagentType);
}

function formatTaskToolPrompt(toolCall: ToolCall | undefined): string | undefined {
  const prompt = readTaskToolArg(toolCall?.args, 'prompt');
  if (!prompt) {
    return undefined;
  }
  return prompt.length > 50 ? `${prompt.slice(0, 47)}…` : prompt;
}

function readTaskToolArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function tryComputeDiff(toolName: string, toolArgs: unknown): DiffData | undefined {
  try {
    if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
      return undefined;
    }

    const record = toolArgs as Record<string, unknown>;
    const filePath = asString(record.file_path) || asString(record.path);
    if (!filePath) {
      return undefined;
    }

    switch (toolName) {
      case TOOL_NAMES.EDIT:
      case TOOL_NAMES.EDIT_FILE: {
        const oldString = asString(record.old_string);
        const newString = asString(record.new_string);
        if (oldString !== undefined && newString !== undefined) {
          return computeEditDiff(filePath, oldString, newString);
        }
        return undefined;
      }
      case TOOL_NAMES.WRITE:
      case TOOL_NAMES.WRITE_FILE: {
        // Don't read disk — file is already written by the time we render.
        // Just compute additions from the content directly.
        const content = asString(record.content);
        if (content !== undefined) {
          const lines = content.split('\n');
          const additions = lines.length;
          return {
            filePath,
            hunks: [],
            additions,
            deletions: 0,
            isNewFile: true,
          };
        }
        return undefined;
      }
      default:
        return undefined;
    }
  } catch {
    // Diff computation failed — graceful degradation
    return undefined;
  }
}

export function shouldHideRuntimeEventForTranscript(event: CodaraRuntimeEvent): boolean {
  if (event.kind === 'hil') {
    return true;
  }

  if (event.kind === 'task') {
    return event.label === 'Subagent started' || event.label === 'Subagent running in background';
  }

  if (event.kind !== 'tool') {
    return false;
  }

  if (event.label.includes(TOOL_NAMES.ASK_USER)) {
    return true;
  }

  const rawToolName = (event.detail ?? '').trim();
  if (isHiddenTranscriptToolName(rawToolName)) {
    return true;
  }
  if (rawToolName === TODO_TOOL_NAME) {
    return true;
  }

  if (parseAskUserResult(event.detail)) {
    return true;
  }
  if (isRepeatedAskUserContinuationNotice(event.detail)) {
    return true;
  }

  const hilPayload = parseHILToolMessagePayload(event.detail);
  return hilPayload?.type === 'hil_pause';
}

function buildRuntimeCoverageFingerprint(item: TranscriptItem): string | undefined {
  if ((item.role !== 'tool' && item.role !== 'task') || !item.toolMeta) {
    return undefined;
  }

  const outputLines = item.toolMeta.allOutputLines ?? item.toolMeta.outputLines ?? [];
  return [
    item.role,
    item.toolMeta.toolName,
    item.toolMeta.args ?? '',
    item.toolMeta.status,
    item.toolMeta.summaryLine,
    outputLines.join('\n'),
  ].join('|');
}

function isRepeatedAskUserContinuationNotice(detail: unknown): boolean {
  return typeof detail === 'string' && detail.includes('AskUserQuestion was just answered in this flow.');
}

function containsHiddenInteractionToolCall(message: AIMessage): boolean {
  if (!Array.isArray(message.tool_calls)) {
    return false;
  }

  return message.tool_calls.some((toolCall) => (
    isInteractionToolName(toolCall?.name)
    || isHiddenTranscriptToolName(toolCall?.name)
  ));
}

function createToolCallLookup(messages: readonly BaseMessage[]): Map<string, ToolCall> {
  const lookup = new Map<string, ToolCall>();
  for (const message of messages) {
    if (!AIMessage.isInstance(message) || !Array.isArray(message.tool_calls)) {
      continue;
    }

    for (const toolCall of message.tool_calls) {
      if (typeof toolCall.id === 'string' && toolCall.id.trim()) {
        lookup.set(toolCall.id, toolCall);
      }
    }
  }

  return lookup;
}

function shouldHideInternalToolMessage(message: ToolMessage): boolean {
  const artifact = message.artifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return false;
  }

  const record = artifact as Record<string, unknown>;
  return record.type === 'ask_user_internal' && record.visibility === 'hidden';
}

function resolveToolMessageName(message: ToolMessage, toolLookup: Map<string, ToolCall>): string | undefined {
  const explicitName = typeof message.name === 'string' ? message.name.trim() : '';
  if (explicitName) {
    return explicitName;
  }

  const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  if (!toolCallId) {
    return undefined;
  }

  return toolLookup.get(toolCallId)?.name;
}

function toolIcon(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return '⚙';
    case TOOL_NAMES.BASH:
      return '⚡';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return '→';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
      return '←';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return '●';
    case TOOL_NAMES.GLOB:
    case TOOL_NAMES.GREP:
      return '✱';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return '%';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return '◈';
    case TOOL_NAMES.TASK_CREATE:
    case TOOL_NAMES.TASK_UPDATE:
    case TOOL_NAMES.TASK_LIST:
      return '│';
    default:
      return '⚙';
  }
}

function formatFriendlyToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return serializeValue(args);
  }

  const record = args as Record<string, unknown>;
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return limitSummary(asString(record.skill));
    case TOOL_NAMES.BASH:
      return limitSummary(asString(record.command) || asString(record.description));
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return formatReadSummary(record);
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return formatFetchSummary(record);
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return limitSummary(asString(record.query));
    case TOOL_NAMES.GLOB:
      return limitSummary(asString(record.pattern) || asString(record.path));
    case TOOL_NAMES.GREP:
      return formatGrepSummary(record);
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return limitSummary(asString(record.file_path) || asString(record.path));
    default:
      return undefined;
  }
}

function isInteractionToolName(toolName: string | undefined): boolean {
  return (toolName || '').trim() === TOOL_NAMES.ASK_USER;
}

function isHiddenTranscriptToolName(toolName: string | undefined): boolean {
  return (toolName || '').trim() === TOOL_NAMES.SKILL;
}

function serializeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatToolDisplayName(toolName: string): string {
  switch (toolName) {
    case TOOL_NAMES.SKILL:
      return 'Skill';
    case TOOL_NAMES.BASH:
      return 'Bash';
    case TOOL_NAMES.READ_FILE:
    case TOOL_NAMES.READ:
      return 'Read';
    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.WRITE:
      return 'Write';
    case TOOL_NAMES.EDIT_FILE:
    case TOOL_NAMES.EDIT:
      return 'Edit';
    case TOOL_NAMES.FETCH_URL:
    case TOOL_NAMES.FETCH:
      return 'Fetch';
    case TOOL_NAMES.WEB_SEARCH:
    case TOOL_NAMES.SEARCH:
      return 'Search';
    case TOOL_NAMES.GLOB:
      return 'Glob';
    case TOOL_NAMES.GREP:
      return 'Grep';
    default:
      return toTitleCase(toolName);
  }
}

function formatReadSummary(record: Record<string, unknown>): string | undefined {
  const filePath = asString(record.file_path) || asString(record.path);
  if (!filePath) {
    return undefined;
  }

  const offset = typeof record.offset === 'number' ? record.offset : undefined;
  const limit = typeof record.limit === 'number' ? record.limit : undefined;
  const range = offset !== undefined || limit !== undefined
    ? `:${offset ?? 0}${limit !== undefined ? `+${limit}` : ''}`
    : '';
  return limitSummary(`${filePath}${range}`);
}

function formatFetchSummary(record: Record<string, unknown>): string | undefined {
  const url = asString(record.url);
  if (!url) {
    return undefined;
  }

  const method = (asString(record.method) || 'GET').toUpperCase();
  return limitSummary(method === 'GET' ? url : `${method} ${url}`);
}

function formatGrepSummary(record: Record<string, unknown>): string | undefined {
  const pattern = asString(record.pattern);
  const targetPath = asString(record.path);
  if (pattern && targetPath) {
    return limitSummary(`${pattern} @ ${targetPath}`);
  }
  return limitSummary(pattern || targetPath);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function limitSummary(value: string | undefined, maxLength = 72): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function toTitleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isAgentToolName(toolName: string | undefined): boolean {
  return toolName === TOOL_NAMES.AGENT
    || toolName === TOOL_NAMES.TASK_CREATE
    || toolName === TOOL_NAMES.TASK_UPDATE
    || toolName === TOOL_NAMES.TASK_LIST;
}

function shouldSuppressActiveTurnInteractionPreamble(
  role: TranscriptRole | undefined,
  runtimeEvents: readonly CodaraRuntimeEvent[] | undefined,
): boolean {
  if (role !== 'assistant' || !runtimeEvents?.length) {
    return false;
  }

  return runtimeEvents.some((event) => {
    if (event.kind !== 'tool') {
      return false;
    }
    const detail = typeof event.detail === 'string' ? event.detail.trim() : '';
    return isInteractionToolName(detail) || isHiddenTranscriptToolName(detail);
  });
}

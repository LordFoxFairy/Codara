import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@/index';
import {parseAskUserResult} from '@engine/pipeline';
import {parseHILToolMessagePayload} from '@engine/pipeline/hil';
import {readMessageText} from '@shared/messages';
import type {CliActiveTurn, CliNotice} from '../app/view-state';
import {formatTokenCount} from '../utils/format';
import {computeEditDiff, type DiffData} from './diff-compute';

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'tool' | 'task' | 'hil' | 'command' | 'error';

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
  limit?: number;
}

export interface HasTranscriptContentInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  initialNoticeCount?: number;
}

export const DEFAULT_TRANSCRIPT_LIMIT = 20;

export function buildTranscriptItems(input: BuildTranscriptItemsInput): TranscriptItem[] {
  const toolLookup = createToolCallLookup(input.coreMessages);
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0 && input.activeTurn !== undefined;
  const items = [
    ...input.notices.map((notice) => ({
      id: notice.id,
      role: notice.level,
      content: notice.content,
    })),
    ...input.coreMessages.flatMap((message, index) => buildCoreMessageItems(message, index, toolLookup, preferRuntimeSteps)),
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
            content: input.activeTurn.response,
          },
        ]
      : []),
    ...(preferRuntimeSteps ? buildRuntimeEventItems(input.runtimeEvents ?? []) : []),
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
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const message = coreMessages[i];
    if (!message) continue;
    items.push(...buildCoreMessageItems(message, i, toolLookup, false));
  }
  return items.filter((item) => item.content);
}

/**
 * Build transcript items for the active (streaming) portion — activeTurn + runtimeEvents only.
 */
export function buildActiveItems(input: {
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
}): TranscriptItem[] {
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0 && input.activeTurn !== undefined;
  const thinkingItem = input.activeTurn?.thinking
    ? [{
        id: `${input.activeTurn.id}-thinking`,
        role: 'system' as const,
        content: `💭 Thinking…\n${input.activeTurn.thinking.slice(-200)}`,
      }]
    : [];
  const items: TranscriptItem[] = [
    ...(input.activeTurn
      ? [
          {
            id: `${input.activeTurn.id}-prompt`,
            role: 'user' as const,
            content: input.activeTurn.prompt,
          },
          ...thinkingItem,
          {
            id: `${input.activeTurn.id}-response`,
            role: input.activeTurn.responseRole,
            content: input.activeTurn.response,
          },
        ]
      : []),
    ...(preferRuntimeSteps ? buildRuntimeEventItems(input.runtimeEvents ?? []) : []),
  ];
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

function buildRuntimeEventItems(events: readonly CodaraRuntimeEvent[]): TranscriptItem[] {
  const startEvents = new Map<string, CodaraRuntimeEvent>();
  const pairedEndIds = new Set<string>();
  const taskToolIds = new Set<string>();
  /** Child tool activity events grouped by parent task ID. */
  const taskChildActivity = new Map<string, CodaraRuntimeEvent[]>();
  const items: TranscriptItem[] = [];
  // Prefix IDs to avoid collisions with solidified transcript items
  // (runtime events share IDs with coreMessages that may already be rendered)
  const activeId = (id: string) => `active-${id}`;

  // First pass: index start events by id, identify Task tool calls, collect child activity
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

  // Inject team event items early so they appear before tool/task items in the stream
  for (const event of events) {
    if (event.kind !== 'team') continue;

    if (event.phase === 'end' && event.parentId) {
      const startEvent = startEvents.get(event.parentId);
      if (startEvent) {
        pairedEndIds.add(event.id);
        const teamName = extractTeamDisplayName(startEvent.label);
        const elapsed = computeElapsedSeconds(startEvent.timestamp, event.timestamp);
        const summary = event.status === 'error'
          ? formatTeamFailedSummary(elapsed, event.detail)
          : event.status === 'paused'
            ? 'Paused'
            : formatTeamDoneSummary(elapsed, event.detail);
        items.push({
          id: activeId(startEvent.id),
          role: 'task',
          content: `⏺ Team "${teamName}"\n${summary}`,
        });
        continue;
      }
    }

    if (event.phase === 'start') {
      // Will be rendered in third pass (unpaired start events)
      continue;
    }

    // Team update events — selectively show key milestones as sub-items
    if (event.phase === 'update' && event.parentId) {
      const label = event.label;
      const isJoinedEvent = label.includes('joined as');
      const isJobDoneEvent = label.includes('Job') && label.includes('completed');
      if (isJoinedEvent || isJobDoneEvent) {
        items.push({
          id: activeId(event.id),
          role: 'task',
          content: `${label}`,
        });
      }
    }
  }

  // Second pass: pair end events with start events, build items
  const pairedTaskEnds: Array<{startEvent: CodaraRuntimeEvent; endEvent: CodaraRuntimeEvent}> = [];
  for (const event of events) {
    if (event.kind === 'turn' || event.kind === 'model' || shouldHideRuntimeEvent(event)) {
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
        pairedTaskEnds.push({startEvent, endEvent: event});
        continue;
      }
    }

    // Tool end event — pair with start
    if (event.kind === 'tool' && event.phase === 'end' && event.parentId) {
      const startEvent = startEvents.get(event.parentId);
      if (startEvent) {
        pairedEndIds.add(event.id);
        const rawToolName = startEvent.detail ?? '';
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

    // Skip start events that have been paired, and team events (handled separately)
    if (event.phase === 'start' && (event.kind === 'tool' || event.kind === 'task' || event.kind === 'team')) {
      continue;
    }

    // Skip team end events (already handled in the team-specific pass above)
    if (event.kind === 'team' && event.phase === 'end') {
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
    const summary = endEvent.status === 'error'
      ? `Failed (${elapsedSec}s)`
      : endEvent.status === 'paused'
        ? 'Waiting for review'
        : formatTaskDoneSummary(elapsedSec, endEvent.detail);
    const {outputLines, allOutputLines, totalOutputLines} = buildToolOutput('Task', status, endEvent.detail);
    items.push({
      id: activeId(startEvent.id),
      role: 'task',
      content: `⚙ ${agentType}(${extractTaskArgs(startEvent.label)})\n${summary}`,
      toolMeta: {
        toolName: 'Task',
        displayName: agentType,
        icon: '⚙',
        args: extractTaskArgs(startEvent.label),
        status: status as 'done' | 'error',
        elapsed,
        summaryLine: summary,
        outputLines,
        allOutputLines,
        totalOutputLines,
      },
    });
  }

  // Third pass: show unpaired start events as "running"
  const unpairedTaskStarts: Array<{id: string; startEvent: CodaraRuntimeEvent}> = [];
  for (const [id, startEvent] of startEvents) {
    if (shouldHideRuntimeEvent(startEvent)) {
      continue;
    }
    const wasPaired = events.some(
      (e) => e.phase === 'end' && e.parentId === id && (e.kind === 'tool' || e.kind === 'task' || e.kind === 'team'),
    );
    if (wasPaired) {
      continue;
    }

    // Unpaired team start → running team block
    if (startEvent.kind === 'team') {
      const teamName = extractTeamDisplayName(startEvent.label);
      const teamGoal = extractTeamGoal(startEvent.label);
      const {memberCount, jobTotal} = parseTeamStartDetail(startEvent.detail);
      const runningStats: string[] = [];
      if (memberCount > 0) runningStats.push(`${memberCount} member${memberCount === 1 ? '' : 's'}`);
      if (jobTotal > 0) runningStats.push(`${jobTotal} jobs planned`);
      const runningLine = runningStats.length > 0
        ? `Running… (${runningStats.join(' · ')})`
        : 'Running…';
      const contentLines = [`⏺ Team "${teamName}"`];
      if (teamGoal) contentLines.push(`  Goal: ${teamGoal}`);
      contentLines.push(runningLine);
      items.push({
        id: activeId(startEvent.id),
        role: 'task',
        content: contentLines.join('\n'),
      });
      continue;
    }

    // Unpaired task start → collected below for grouped rendering
    if (startEvent.kind === 'task') {
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
    const activityLines = formatChildActivityLines(childActivities);
    const summaryLine = activityLines.length > 0 ? activityLines.join('\n') : '…';
    items.push({
      id: activeId(taskId),
      role: 'task',
      content: `⚙ ${agentType}(${extractTaskArgs(startEvent.label)})\n${summaryLine}`,
      toolMeta: {
        toolName: 'Task',
        displayName: agentType,
        icon: '⚙',
        args: extractTaskArgs(startEvent.label),
        status: 'running',
        summaryLine,
      },
    });
  }

  return items;
}

/** Format child agent tool activity lines for display under a running task. */
function formatChildActivityLines(activities: CodaraRuntimeEvent[]): string[] {
  if (activities.length === 0) return [];
  // Show the most recent activities (tail)
  const recent = activities.slice(-MAX_CHILD_ACTIVITY_LINES);
  const lines = recent.map(a => `  ⎿ ${a.label}`);
  const overflow = activities.length - MAX_CHILD_ACTIVITY_LINES;
  if (overflow > 0) {
    lines.unshift(`  … +${overflow} more`);
  }
  return lines;
}

function extractSubagentType(label: string): string {
  // "Delegating Plan: some description" → "Plan"
  const match = label.match(/^Delegating\s+([\w-]+)/);
  if (!match) return 'Task';
  const type = match[1]!;
  if (type === 'general-purpose') return 'Agent';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Extract just the description (without agent type prefix) for toolMeta.args. */
function extractTaskArgs(label: string): string {
  const firstLine = label.split('\n')[0]!.trim();
  const text = firstLine.startsWith('Delegating ') ? firstLine.slice('Delegating '.length) : firstLine;
  const colonIndex = text.indexOf(': ');
  const desc = colonIndex > 0 ? text.slice(colonIndex + 2) : text;
  return desc.length > 50 ? `${desc.slice(0, 47)}…` : desc;
}


function extractTeamDisplayName(label: string): string {
  // "Team frontend-refactor: Implement the frontend" → "frontend-refactor"
  const match = label.match(/^Team\s+([^:]+?)(?::\s+.*)?$/);
  if (match?.[1]) {
    return match[1].trim().slice(0, 40);
  }
  return label.slice(0, 40);
}

function extractTeamGoal(label: string): string | undefined {
  // "Team frontend-refactor: Build UI components" → "Build UI components"
  const colonIdx = label.indexOf(': ');
  if (colonIdx > 0) {
    const goal = label.slice(colonIdx + 2).trim();
    return goal.length > 80 ? `${goal.slice(0, 77)}...` : goal;
  }
  return undefined;
}

function parseTeamStartDetail(detail?: string): {memberCount: number; jobTotal: number} {
  const memberMatch = detail?.match(/memberCount:(\d+)/);
  const jobTotalMatch = detail?.match(/jobTotal:(\d+)/);
  return {
    memberCount: memberMatch ? parseInt(memberMatch[1]!, 10) : 0,
    jobTotal: jobTotalMatch ? parseInt(jobTotalMatch[1]!, 10) : 0,
  };
}

function formatTeamDoneSummary(elapsed: number, detail?: string): string {
  const parts: string[] = [];
  if (detail) {
    const doneMatch = detail.match(/done:(\d+)/);
    const totalMatch = detail.match(/total:(\d+)/);
    const membersMatch = detail.match(/members:(\d+)/);
    const tokenMatch = detail.match(/([\d.]+[kKmM]?)\s+tokens?/);
    if (doneMatch && totalMatch) parts.push(`${doneMatch[1]}/${totalMatch[1]} jobs`);
    if (membersMatch) parts.push(`${membersMatch[1]} members`);
    if (tokenMatch) parts.push(`${tokenMatch[1]} tokens`);
  }
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  parts.push(timeStr);
  return `Done (${parts.join(' · ')})`;
}

function formatTeamFailedSummary(elapsed: number, detail?: string): string {
  const parts: string[] = [];
  if (detail) {
    const doneMatch = detail.match(/done:(\d+)/);
    const totalMatch = detail.match(/total:(\d+)/);
    // Extract error reason: "error:<reason>" — strip the structured parts first
    const errorMatch = detail.match(/error:(.+?)(?:\s+\w+:\S+|$)/);
    const errorReason = errorMatch?.[1]?.trim();
    if (errorReason) parts.unshift(errorReason);
    if (doneMatch && totalMatch) parts.push(`${doneMatch[1]}/${totalMatch[1]} jobs`);
  }
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  parts.push(timeStr);
  return `Failed: ${parts.join(' · ')}`;
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
    case 'write_file':
    case 'write': {
      const lines = truncateOutput(trimmed);
      const lineCount = lines.total;
      const fileMatch = trimmed.match(/^Wrote \d+ lines? to (.+)/);
      const summaryLine = fileMatch
        ? `Wrote ${lineCount} lines to ${fileMatch[1]}`
        : `Wrote ${lineCount} lines`;
      return {summaryLine, outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case 'edit_file':
    case 'edit': {
      const lines = truncateOutput(trimmed);
      return {summaryLine: buildEditSummary(trimmed), outputLines: lines.visible, allOutputLines: lines.all, totalOutputLines: lines.total};
    }
    case 'bash': {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), allOutputLines: lines.all.slice(1), totalOutputLines: lines.total};
    }
    case 'Task': {
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
      return 'hil';
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
  toolLookup: Map<string, ToolCall>,
  preferRuntimeSteps: boolean,
): TranscriptItem[] {
  const messageId = String(message.id ?? `${message.type}-${index}`);

  if (AIMessage.isInstance(message)) {
    return buildAssistantItems(message, messageId);
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

function buildAssistantItems(message: AIMessage, messageId: string): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const text = readMessageText(message);
  if (text) {
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

  const resolvedName = resolveToolMessageName(message, toolLookup);
  if (isInteractionToolName(resolvedName) || parseAskUserResult(text)) {
    return [];
  }
  const role: TranscriptRole = isTaskToolName(resolvedName) ? 'task' : 'tool';
  const formattedContent = role === 'task' ? formatTaskResultText(text) : text;
  const lineCount = formattedContent.split('\n').length;

  // Build toolMeta for non-task tool results
  const toolMeta = resolvedName && !isTaskToolName(resolvedName)
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
      case 'edit':
      case 'edit_file': {
        const oldString = asString(record.old_string);
        const newString = asString(record.new_string);
        if (oldString !== undefined && newString !== undefined) {
          return computeEditDiff(filePath, oldString, newString);
        }
        return undefined;
      }
      case 'write':
      case 'write_file': {
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

function shouldHideRuntimeEvent(event: CodaraRuntimeEvent): boolean {
  if (event.kind === 'hil') {
    return true;
  }

  if (event.kind !== 'tool') {
    return false;
  }

  if (event.label.includes('AskUserQuestion')) {
    return true;
  }

  if (parseAskUserResult(event.detail)) {
    return true;
  }

  const hilPayload = parseHILToolMessagePayload(event.detail);
  return hilPayload?.type === 'hil_pause';
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
    case 'bash':
      return '⚡';
    case 'read_file':
    case 'read':
      return '→';
    case 'write_file':
    case 'write':
      return '←';
    case 'edit_file':
    case 'edit':
      return '●';
    case 'glob':
    case 'grep':
      return '✱';
    case 'fetch_url':
    case 'fetch':
      return '%';
    case 'web_search':
    case 'search':
      return '◈';
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
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
    case 'bash':
      return limitSummary(asString(record.command) || asString(record.description));
    case 'read_file':
    case 'read':
      return formatReadSummary(record);
    case 'fetch_url':
    case 'fetch':
      return formatFetchSummary(record);
    case 'web_search':
    case 'search':
      return limitSummary(asString(record.query));
    case 'glob':
      return limitSummary(asString(record.pattern) || asString(record.path));
    case 'grep':
      return formatGrepSummary(record);
    case 'write_file':
    case 'write':
    case 'edit_file':
    case 'edit':
      return limitSummary(asString(record.file_path) || asString(record.path));
    default:
      return undefined;
  }
}

function isInteractionToolName(toolName: string | undefined): boolean {
  return (toolName || '').trim() === 'AskUserQuestion';
}

function formatTaskResultText(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      if (!line.includes(' | ')) {
        return line;
      }

      const [first, ...rest] = line.split(' | ');
      return [first, ...rest.map((part) => `  ${part}`)].join('\n');
    })
    .join('\n');
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
    case 'bash':
      return 'Bash';
    case 'read_file':
    case 'read':
      return 'Read';
    case 'write_file':
    case 'write':
      return 'Write';
    case 'edit_file':
    case 'edit':
      return 'Edit';
    case 'fetch_url':
    case 'fetch':
      return 'Fetch';
    case 'web_search':
    case 'search':
      return 'Search';
    case 'glob':
      return 'Glob';
    case 'grep':
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

function isTaskToolName(toolName: string | undefined): boolean {
  return toolName === 'TaskCreate' || toolName === 'TaskUpdate' || toolName === 'TaskList';
}

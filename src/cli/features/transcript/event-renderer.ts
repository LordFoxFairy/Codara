import {parseAskUserResult, parseReviewToolMessagePayload, type CodaraRuntimeEvent} from '@/index';
import {TOOL_NAMES, formatToolHeaderArgs} from '@shared/tool-display';
import type {ToolResultMeta, TranscriptItem} from './model';
import {
  TODO_TOOL_NAME,
  isInteractionToolName,
  isHiddenTranscriptToolName,
  isRepeatedAskUserContinuationNotice,
  buildToolMetaFromEvents,
  buildToolMetaRunning,
  formatElapsed,
  parseAgentRuntimeLabel,
  buildAgentCoverageKey,
} from './tool-formatter';

// ── Public API ────────────────────────────────────────────────────

export function buildRuntimeEventItems(events: readonly CodaraRuntimeEvent[], _nowTimestamp?: string): TranscriptItem[] {
  const endEvents = new Map<string, CodaraRuntimeEvent>();
  const childUpdates = new Map<string, CodaraRuntimeEvent[]>();
  const taskToolIds = new Set<string>();
  const items: TranscriptItem[] = [];
  const activeId = (id: string) => `active-${id}`;

  // First pass: index start/end/update events, identify Agent parent tool calls.
  for (const event of events) {
    if (event.phase === 'end' && event.parentId) {
      endEvents.set(event.parentId, event);
    }
    if (event.phase === 'update' && event.parentId) {
      const bucket = childUpdates.get(event.parentId) ?? [];
      bucket.push(event);
      childUpdates.set(event.parentId, bucket);
    }
    if (event.kind === 'agent' && event.phase === 'start' && isConcreteSubagentRuntimeEvent(event) && event.parentId) {
      taskToolIds.add(event.parentId);
    }
  }

  // Second pass: render execution blocks from their start event.
  for (const event of events) {
    if (event.phase !== 'start') {
      continue;
    }
    if (event.kind === 'turn' || event.kind === 'model' || shouldHideRuntimeEventForTranscript(event)) {
      continue;
    }

    if (event.kind === 'agent') {
      if (!isConcreteSubagentRuntimeEvent(event)) {
        continue;
      }
      const runtimeItem = buildAgentRuntimeItem({
        startEvent: event,
        updateEvents: childUpdates.get(event.id) ?? [],
        endEvent: endEvents.get(event.id),
      });
      if (runtimeItem) {
        items.push({
          ...runtimeItem,
          id: activeId(event.id),
        });
      }
      continue;
    }

    // Skip tool events that parent an Agent run.
    if (event.kind === 'tool' && taskToolIds.has(event.id)) {
      continue;
    }

    if (event.kind !== 'tool') {
      continue;
    }

    const rawToolName = (event.detail ?? '').trim();
    if (rawToolName === TOOL_NAMES.AGENT || isInteractionToolName(rawToolName) || rawToolName === TODO_TOOL_NAME) {
      continue;
    }
    const endEvent = endEvents.get(event.id);
    if (endEvent && parseReviewToolMessagePayload(endEvent.detail)?.type === 'review_pause') {
      continue;
    }
    if (endEvent && isRepeatedAskUserContinuationNotice(endEvent.detail)) {
      continue;
    }
    const toolMeta = endEvent
      ? buildToolMetaFromEvents(rawToolName, event, endEvent)
      : buildToolMetaRunning(rawToolName, event);
    const content = toolMeta
      ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n${toolMeta.summaryLine}`
      : formatRuntimeEvent(endEvent ?? event);
    items.push({
      id: activeId(event.id),
      role: 'tool',
      content,
      toolMeta: toolMeta ?? undefined,
    });
  }

  return items;
}

export function isConcreteSubagentRuntimeEvent(event: CodaraRuntimeEvent): boolean {
  return event.id.startsWith('subagent-run:');
}

export function shouldHideRuntimeEventForTranscript(event: CodaraRuntimeEvent): boolean {
  if (event.kind === 'review') {
    return true;
  }

  if (event.kind === 'agent') {
    return event.label === 'Subagent started'
      || event.label === 'Subagent running in background';
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

  const reviewPayload = parseReviewToolMessagePayload(event.detail);
  return reviewPayload?.type === 'review_pause';
}

// ── Agent runtime item builders ───────────────────────────────────

function buildAgentRuntimeItem(input: {
  startEvent: CodaraRuntimeEvent;
  updateEvents: readonly CodaraRuntimeEvent[];
  endEvent?: CodaraRuntimeEvent;
}): TranscriptItem | undefined {
  const {startEvent, updateEvents, endEvent} = input;
  const label = parseAgentRuntimeLabel(startEvent.label);
  const status = endEvent?.status === 'error'
    ? 'error'
    : endEvent?.status === 'paused'
      ? 'running'
      : endEvent
        ? 'done'
        : 'running';
  const elapsed = endEvent ? formatElapsed(startEvent.timestamp, endEvent.timestamp) : undefined;
  const outputLines = summarizeAgentActivity(updateEvents, endEvent);
  const summaryLine = buildAgentRuntimeSummaryLine(status, endEvent, elapsed);
  const rawArgs = label.args?.length ? label.args : undefined;
  const args = rawArgs ? formatToolHeaderArgs(TOOL_NAMES.AGENT, rawArgs) : undefined;
  return {
    id: startEvent.id,
    role: 'agent',
    content: `\u23FA ${label.displayName}${args ? `(${args})` : ''}\n${summaryLine}`,
    toolMeta: {
      toolName: TOOL_NAMES.AGENT,
      displayName: label.displayName,
      icon: '\u23FA',
      ...(args ? {args} : {}),
      ...(readSubagentRuntimeRunId(startEvent.id) ? {runId: readSubagentRuntimeRunId(startEvent.id)} : {}),
      coverageKey: buildAgentCoverageKey(label.displayName, rawArgs, status),
      status,
      ...(elapsed ? {elapsed} : {}),
      summaryLine,
      ...(outputLines.length ? {outputLines: outputLines.slice(-6)} : {}),
      ...(outputLines.length ? {allOutputLines: outputLines} : {}),
      ...(outputLines.length ? {totalOutputLines: outputLines.length} : {}),
    },
  };
}

function summarizeAgentActivity(
  updateEvents: readonly CodaraRuntimeEvent[],
  endEvent?: CodaraRuntimeEvent,
): string[] {
  const lines = updateEvents
    .map((event) => [event.label, event.detail].filter(Boolean).join(': ').trim())
    .filter(Boolean);

  const terminalDetail = endEvent?.detail?.trim();
  if (terminalDetail) {
    lines.push(terminalDetail);
  }

  return dedupeActivityLines(lines);
}

function dedupeActivityLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const line of lines) {
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    ordered.push(line);
  }
  return ordered;
}

function buildAgentRuntimeSummaryLine(
  status: 'running' | 'done' | 'error',
  endEvent: CodaraRuntimeEvent | undefined,
  elapsed: string | undefined,
): string {
  if (status === 'error') {
    return elapsed ? `Failed (${elapsed})` : 'Failed';
  }
  if (endEvent?.status === 'paused') {
    return elapsed ? `Waiting for review (${elapsed})` : 'Waiting for review';
  }
  if (status === 'done') {
    return elapsed ? `Done (${elapsed})` : 'Done';
  }
  return elapsed ? `Running (${elapsed})` : 'Running';
}

function formatRuntimeEvent(event: CodaraRuntimeEvent): string {
  if (event.kind === 'tool' || event.kind === 'agent') {
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

function readSubagentRuntimeRunId(eventId: string): string | undefined {
  return eventId.startsWith('subagent-run:') ? eventId.slice('subagent-run:'.length) : undefined;
}

import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@core';
import {parseAskUserResult} from '@core/middleware';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {readMessageText} from '@core/shared/messages';
import type {CliActiveTurn, CliNotice} from '../app/view-state';
import {computeEditDiff, computeWriteDiff, type DiffData} from './diff-compute';

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'tool' | 'task' | 'hil' | 'command' | 'error';

export interface ToolResultMeta {
  toolName: string;
  displayName: string;
  icon: string;
  args?: string;
  status: 'running' | 'done' | 'error';
  summaryLine: string;
  outputLines?: string[];
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
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0;
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
    ...buildRuntimeEventItems(input.runtimeEvents ?? []),
  ];

  return items
    .filter((item) => item.content)
    .slice(-(input.limit ?? DEFAULT_TRANSCRIPT_LIMIT));
}

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

function buildRuntimeEventItems(events: readonly CodaraRuntimeEvent[]): TranscriptItem[] {
  const startEvents = new Map<string, CodaraRuntimeEvent>();
  const pairedEndIds = new Set<string>();
  const items: TranscriptItem[] = [];

  // First pass: index start events by id
  for (const event of events) {
    if (event.phase === 'start') {
      startEvents.set(event.id, event);
    }
  }

  // Second pass: pair end events with start events, build items
  for (const event of events) {
    if (event.kind === 'turn' || event.kind === 'model' || shouldHideRuntimeEvent(event)) {
      continue;
    }

    // Tool end event — pair with start
    if (event.kind === 'tool' && event.phase === 'end' && event.parentId) {
      const startEvent = startEvents.get(event.parentId);
      if (startEvent) {
        pairedEndIds.add(event.id);
        const rawToolName = startEvent.detail ?? '';
        const toolMeta = buildToolMetaFromEvents(rawToolName, startEvent, event);
        const content = toolMeta
          ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n└ ${toolMeta.summaryLine}`
          : formatRuntimeEvent(event);
        items.push({
          id: startEvent.id,
          role: mapRuntimeEventRole(event.kind),
          content,
          toolMeta: toolMeta ?? undefined,
        });
        continue;
      }
    }

    // Skip start events that have been paired
    if (event.phase === 'start' && event.kind === 'tool') {
      // Will be rendered when the end event arrives; if no end event, show as running below
      continue;
    }

    items.push({
      id: event.id,
      role: mapRuntimeEventRole(event.kind),
      content: formatRuntimeEvent(event),
    });
  }

  // Third pass: show unpaired tool start events as "running"
  for (const [id, startEvent] of startEvents) {
    if (startEvent.kind !== 'tool' || shouldHideRuntimeEvent(startEvent)) {
      continue;
    }
    // Check if this start event was paired with an end event
    const wasPaired = events.some(
      (e) => e.phase === 'end' && e.parentId === id && e.kind === 'tool',
    );
    if (!wasPaired) {
      const rawToolName = startEvent.detail ?? '';
      const toolMeta = buildToolMetaRunning(rawToolName, startEvent);
      const content = toolMeta
        ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n└ ${toolMeta.summaryLine}`
        : formatRuntimeEvent(startEvent);
      items.push({
        id: startEvent.id,
        role: 'tool',
        content,
        toolMeta: toolMeta ?? undefined,
      });
    }
  }

  return items;
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
  const {summaryLine, outputLines, totalOutputLines} = buildToolOutput(rawToolName, status, endEvent.detail);

  return {toolName: rawToolName, displayName, icon, args, status, summaryLine, outputLines, totalOutputLines};
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
): {summaryLine: string; outputLines?: string[]; totalOutputLines?: number} {
  if (status === 'error') {
    const lines = truncateOutput(detail);
    return {
      summaryLine: 'Error',
      outputLines: lines.visible,
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
      return {summaryLine, outputLines: lines.visible, totalOutputLines: lines.total};
    }
    case 'edit_file':
    case 'edit': {
      const lines = truncateOutput(trimmed);
      return {summaryLine: buildEditSummary(trimmed), outputLines: lines.visible, totalOutputLines: lines.total};
    }
    case 'bash': {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), totalOutputLines: lines.total};
    }
    default: {
      if (!trimmed) {
        return {summaryLine: 'Done'};
      }
      const lines = truncateOutput(trimmed);
      return {summaryLine: lines.visible[0] ?? 'Done', outputLines: lines.visible.slice(1), totalOutputLines: lines.total};
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

function truncateOutput(detail?: string, maxLines: number = TOOL_META_MAX_LINES): {visible: string[]; total: number} {
  if (!detail?.trim()) {
    return {visible: [], total: 0};
  }
  const allLines = detail.trim().split('\n');
  const total = allLines.length;
  const visible = allLines.slice(0, maxLines);
  return {visible, total};
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
    return buildAssistantItems(message, messageId, preferRuntimeSteps);
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

function buildAssistantItems(message: AIMessage, messageId: string, preferRuntimeSteps: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const text = readMessageText(message);
  if (text) {
    items.push({
      id: messageId,
      role: 'assistant',
      content: text,
    });
  }

  if (preferRuntimeSteps) {
    return items;
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    const visibleToolCalls = toolCalls.filter((toolCall) => !isInteractionToolName(toolCall.name));
    if (visibleToolCalls.length === 0) {
      return items;
    }
    items.push({
      id: `${messageId}-tools`,
      role: visibleToolCalls.every((toolCall) => isTaskToolName(toolCall.name)) ? 'task' : 'tool',
      content: formatToolCallGroup(visibleToolCalls),
    });
  }

  return items;
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
      ? `${toolMeta.icon} ${toolMeta.displayName}(${toolMeta.args ?? ''})\n└ ${toolMeta.summaryLine}`
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
  const {summaryLine, outputLines, totalOutputLines} = buildToolOutput(rawToolName, status as 'done' | 'error', text);

  // Compute diff data for edit/write tools when tool args are available
  const diffData = toolCall ? tryComputeDiff(rawToolName, toolCall.args) : undefined;

  return {toolName: rawToolName, displayName, icon, args, status: status as 'done' | 'error', summaryLine, outputLines, totalOutputLines, diffData};
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
        const content = asString(record.content);
        if (content !== undefined) {
          return computeWriteDiff(filePath, content);
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

  if (event.label.includes('AskUser')) {
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

function formatToolCallGroup(toolCalls: readonly ToolCall[]): string {
  if (toolCalls.length === 1) {
    return formatToolCall(toolCalls[0] as ToolCall);
  }

  return toolCalls.map((toolCall) => `- ${formatToolCall(toolCall)}`).join('\n');
}

function formatToolCall(toolCall: ToolCall): string {
  const name = toolCall.name || 'tool';
  const icon = toolIcon(name);
  const summary = formatFriendlyToolSummary(name, toolCall.args);
  if (summary) {
    return `${icon} ${formatToolDisplayName(name)}(${summary})`;
  }

  const args = formatToolCallArgs(name, toolCall.args);
  return args ? `${icon} ${formatToolDisplayName(name)}(${args})` : `${icon} ${formatToolDisplayName(name)}`;
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

function formatToolCallArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return serializeValue(args);
  }

  const record = args as Record<string, unknown>;
  if (isTaskToolName(toolName)) {
    const orderedEntries = Object.entries(record)
      .filter(([, value]) => value !== undefined && value !== null && value !== '');
    return orderedEntries.map(([key, value]) => `${key}: ${serializeValue(value)}`).join(' | ');
  }

  return serializeObject(record);
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
  return (toolName || '').trim() === 'AskUser';
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

function serializeObject(value: Record<string, unknown>): string | undefined {
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => `${key}: ${serializeValue(entryValue)}`);

  return entries.length > 0 ? entries.join(' | ') : undefined;
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

import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@core';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {readMessageText} from '@core/shared/messages';
import type {CliActiveTurn, CliNotice} from '../app/view-state';

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'tool' | 'task' | 'hil' | 'command' | 'error';

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  content: string;
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
  return events.map((event) => {
    if (event.kind === 'turn' || event.kind === 'model') {
      return undefined;
    }

    return {
      id: event.id,
      role: mapRuntimeEventRole(event.kind),
      content: formatRuntimeEvent(event),
    };
  }).filter((item): item is TranscriptItem => Boolean(item));
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
  const phaseLabel = event.phase === 'start'
    ? 'start'
    : event.phase === 'update'
      ? 'update'
      : 'done';

  return [phaseLabel, event.label, event.detail].filter(Boolean).join('\n');
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
  const role: TranscriptRole = isTaskToolName(resolvedName) ? 'task' : 'tool';

  return [{
    id: messageId,
    role,
    content: role === 'task' ? formatTaskResultText(text) : text,
  }];
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
  const summary = formatFriendlyToolSummary(name, toolCall.args);
  if (summary) {
    return `${formatToolDisplayName(name)}(${summary})`;
  }

  const args = formatToolCallArgs(name, toolCall.args);
  return args ? `${formatToolDisplayName(name)}(${args})` : formatToolDisplayName(name);
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

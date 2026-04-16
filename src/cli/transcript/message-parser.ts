import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ToolCall} from '@langchain/core/messages';
import {
  isSubagentInternalAssistantText,
  type CodaraRuntimeEvent,
} from '@/index';
import {readMessageText} from '@shared/messages';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {TOOL_NAMES} from '@shared/tool-display';
import type {SubagentRunQuerySummary} from '@codara/types';
import {formatTokenCount} from '../utils/format';
import type {TranscriptItem, TranscriptRole} from './model';
import {
  isAgentToolName,
  isInteractionToolName,
  isHiddenTranscriptToolName,
  resolveToolMessageName,
  buildToolResultItems,
} from './tool-formatter';

// ── Tool call lookup ──────────────────────────────────────────────

export function createToolCallLookup(messages: readonly BaseMessage[]): Map<string, ToolCall> {
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

// ── Core message → TranscriptItem conversion ──────────────────────

export function mapCoreMessageRole(message: BaseMessage): TranscriptRole {
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

export function buildCoreMessageItems(
  message: BaseMessage,
  index: number,
  allMessages: readonly BaseMessage[],
  toolLookup: Map<string, ToolCall>,
  preferRuntimeSteps: boolean,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): TranscriptItem[] {
  const messageId = String(message.id ?? `${message.type}-${index}`);

  if (AIMessage.isInstance(message)) {
    const previousMessage = index > 0 ? allMessages[index - 1] : undefined;
    return buildAssistantItems(message, messageId, previousMessage, toolLookup, preserveVisibleAssistantTexts, subagentRuns);
  }

  if (ToolMessage.isInstance(message)) {
    if (preferRuntimeSteps) {
      return [];
    }
    return buildToolResultItems(message, messageId, index, allMessages, toolLookup);
  }

  const text = readMessageText(message);
  return text ? [{
    id: messageId,
    role: mapCoreMessageRole(message),
    content: text,
  }] : [];
}

// ── Assistant message items ───────────────────────────────────────

function buildAssistantItems(
  message: AIMessage,
  messageId: string,
  previousMessage: BaseMessage | undefined,
  toolLookup: Map<string, ToolCall>,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const text = readMessageText(message);
  if (text && containsHiddenInteractionToolCall(message)) {
    return items;
  }
  if (text && isSubagentInternalAssistantText({text, runs: subagentRuns})) {
    return items;
  }
  const preserveVisibleText = text ? preserveVisibleAssistantTexts?.has(normalizeVisibleAssistantText(text)) ?? false : false;
  const suppressLaunchChatter = shouldSuppressSolidifiedTaskLaunchChatter(message, previousMessage, toolLookup);
  if (
    text
    && (preserveVisibleText || !suppressLaunchChatter)
    && !suppressLaunchChatter
  ) {
    items.push({
      id: messageId,
      role: 'assistant',
      content: text,
      tokenAnnotation: readTokenAnnotation(message),
    });
  }

  return items;
}

// ── Visible text normalization ────────────────────────────────────

export function normalizeVisibleAssistantText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

// ── Token annotation ──────────────────────────────────────────────

function readTokenAnnotation(message: AIMessage): string | undefined {
  const meta = message.usage_metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  const input = (typeof meta.input_tokens === 'number' ? meta.input_tokens : 0)
    || (typeof meta.prompt_tokens === 'number' ? meta.prompt_tokens : 0);
  const output = (typeof meta.output_tokens === 'number' ? meta.output_tokens : 0)
    || (typeof meta.completion_tokens === 'number' ? meta.completion_tokens : 0);

  if (input === 0 && output === 0) return undefined;

  return `\u2193${formatTokenCount(input)} \u2191${formatTokenCount(output)}`;
}

// ── Suppression logic ─────────────────────────────────────────────

export function shouldSuppressAssistantTaskLaunchChatter(
  response: string | undefined,
  role: TranscriptRole | undefined,
  runtimeEvents: readonly CodaraRuntimeEvent[] | undefined,
  pendingAgentLaunch: boolean | undefined = false,
  suppressAgentLaunchResponse: boolean | undefined = false,
): boolean {
  if (role !== 'assistant') {
    return false;
  }

  const text = response?.trim();
  if (!text) {
    return false;
  }

  if (pendingAgentLaunch && (suppressAgentLaunchResponse || containsTaskLaunchChatter(text))) {
    return true;
  }

  const hasLiveAgentRuntime = (runtimeEvents ?? []).some((event) => (
    event.kind === 'agent'
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
  if (!isAgentToolName(previousToolName) || !readSubagentRunLaunchResult(previousMessage.artifact)) {
    return false;
  }

  return shouldSuppressAssistantTaskLaunchChatter(text, 'assistant', [{
    id: 'task-launch',
    sessionId: 'task-launch',
    timestamp: new Date(0).toISOString(),
    kind: 'agent',
    phase: 'start',
    status: 'running',
    label: 'Delegating Agent',
  }]);
}

export function containsTaskLaunchChatter(text: string): boolean {
  const launchChatterSignals = [
    '\u4EFB\u52A1\u5DF2\u542F\u52A8',
    '\u59D4\u6D3E\u4FE1\u606F',
    '\u6B63\u5728\u7B49\u5F85 subagent',
    'subagent \u5DF2\u542F\u52A8',
    '\u6211\u5DF2\u542F\u52A8',
    '\u6211\u5DF2\u4F7F\u7528 Agent \u5DE5\u5177\u59D4\u6D3E',
    '\u6211\u5C06\u7ACB\u5373\u4F7F\u7528 Agent \u5DE5\u5177\u59D4\u6D3E',
    '\u6211\u5C06\u7ACB\u5373\u5E76\u884C\u59D4\u6D3E',
    '\u6211\u5C06\u5E76\u884C\u59D4\u6D3E',
    '\u5E76\u884C\u59D4\u6D3E',
    'I used the Agent tool',
    'Subagent started',
    'run_id:',
    '\u5F85\u8BE5\u4EE3\u7406\u5B8C\u6210',
    '\u6211\u5C06\u7ACB\u5373\u7ED9\u51FA',
    'waiting for the subagent',
  ];

  if (launchChatterSignals.some((signal) => text.includes(signal))) {
    return true;
  }

  return /(?:\u7ACB\u5373|\u73B0\u5728|\u9A6C\u4E0A).*(?:\u5E76\u884C)?\u59D4\u6D3E.*(?:subagent|Agent)/i.test(text)
    || /(?:dispatch|launch).*(?:parallel|multiple)?\s*(?:subagents?|agents?)/i.test(text);
}

function messageContainsTaskToolCall(message: AIMessage): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.some((toolCall) => isAgentToolName(toolCall?.name));
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

export function shouldSuppressActiveTurnInteractionPreamble(
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

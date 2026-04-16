/**
 * Transcript model -- the core data layer for building displayable transcript items.
 *
 * Orchestrates message parsing, runtime event rendering, deduplication, and
 * fingerprinting to produce TranscriptItem arrays consumed by the transcript
 * and solidified-block components. Sub-modules (message-parser, event-renderer,
 * diff-compute, tool-formatter) handle specific concerns.
 */
import {AIMessage, HumanMessage, ToolMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import {readMessageText} from '@shared/messages';
import {TOOL_NAMES} from '@shared/tool-display';
import type {CodaraRuntimeEvent} from '@/index';
import type {SubagentRunQuerySummary} from '@codara/types';
import type {CliActiveTurn, CliNotice, CliRunState} from '../app/view-state';
import type {DiffData} from './diff-compute';

// Re-export sub-modules so all consumers keep working via `transcript/model`.
export {createToolCallLookup, buildCoreMessageItems, normalizeVisibleAssistantText} from './message-parser';
export {shouldHideRuntimeEventForTranscript} from './event-renderer';

// Internal imports (not re-exported)
import {createToolCallLookup, buildCoreMessageItems, shouldSuppressAssistantTaskLaunchChatter, shouldSuppressActiveTurnInteractionPreamble} from './message-parser';
import {buildRuntimeEventItems, isConcreteSubagentRuntimeEvent} from './event-renderer';

// ── Types ─────────────────────────────────────────────────────────

export type TranscriptRole = 'system' | 'warning' | 'user' | 'assistant' | 'tool' | 'agent' | 'review' | 'command' | 'error';

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
  runId?: string;
  coverageKey?: string;
  status: 'running' | 'paused' | 'done' | 'error';
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
  subagentRuns?: readonly SubagentRunQuerySummary[];
}

export interface HasTranscriptContentInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  initialNoticeCount?: number;
}

export const DEFAULT_TRANSCRIPT_LIMIT = 20;

// ── Deduplication / Fingerprinting ────────────────────────────────

export function dedupeTrailingTranscriptItemsCoveredByRuntime(
  trailingItems: readonly TranscriptItem[],
  runtimeItems: readonly TranscriptItem[],
): TranscriptItem[] {
  const runtimeFingerprints = new Set(
    runtimeItems
      .map(buildCanonicalTranscriptFingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
  );

  if (runtimeFingerprints.size === 0) {
    return [...trailingItems];
  }

  return trailingItems.filter((item) => {
    const fingerprint = buildCanonicalTranscriptFingerprint(item);
    return !fingerprint || !runtimeFingerprints.has(fingerprint);
  });
}

export function dedupeCanonicalTranscriptItems(
  items: readonly TranscriptItem[],
): TranscriptItem[] {
  const seenFingerprints = new Set<string>();
  const deduped: TranscriptItem[] = [];

  for (const item of items) {
    const fingerprint = buildCanonicalTranscriptFingerprint(item);
    if (!fingerprint) {
      deduped.push(item);
      continue;
    }

    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    seenFingerprints.add(fingerprint);
    deduped.push(item);
  }

  return deduped;
}

export function buildCanonicalTranscriptFingerprint(item: TranscriptItem): string | undefined {
  if ((item.role !== 'tool' && item.role !== 'agent') || !item.toolMeta) {
    return undefined;
  }

  if (item.role === 'agent' && item.toolMeta.toolName === TOOL_NAMES.AGENT) {
    if (item.toolMeta.runId) {
      return [item.role, item.toolMeta.runId].join('|');
    }

    return [item.role, item.toolMeta.displayName, item.toolMeta.args ?? ''].join('|');
  }

  if (item.toolMeta.coverageKey) {
    return [item.role, item.toolMeta.coverageKey].join('|');
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

// ── Orchestration: buildTranscriptItems ───────────────────────────

export function buildTranscriptItems(input: BuildTranscriptItemsInput): TranscriptItem[] {
  const toolLookup = createToolCallLookup(input.coreMessages);
  const preferRuntimeSteps = (input.runtimeEvents?.length ?? 0) > 0 && input.activeTurn !== undefined;
  const suppressActiveTurnResponse = shouldSuppressAssistantTaskLaunchChatter(
    input.activeTurn?.response,
    input.activeTurn?.responseRole,
    input.runtimeEvents,
    input.activeTurn?.pendingAgentLaunch,
    input.activeTurn?.suppressAgentLaunchResponse,
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
      input.subagentRuns,
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

// ── Orchestration: buildSolidifiedItemsFromRange ──────────────────

/**
 * Build transcript items from a range of coreMessages (for solidified/completed turns).
 * No limit, no activeTurn, no runtimeEvents — just finalized messages.
 */
export function buildSolidifiedItemsFromRange(
  coreMessages: readonly BaseMessage[],
  startIndex: number,
  endIndex: number,
  toolLookup: Map<string, import('@langchain/core/messages').ToolCall>,
  preserveVisibleAssistantTexts?: ReadonlySet<string>,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const message = coreMessages[i];
    if (!message) continue;
    items.push(...buildCoreMessageItems(message, i, coreMessages, toolLookup, false, preserveVisibleAssistantTexts, subagentRuns));
  }
  return items.filter((item) => item.content);
}

// ── Orchestration: buildActiveItems ───────────────────────────────

/**
 * Build transcript items for the active (streaming) portion — activeTurn + runtimeEvents only.
 */
export function buildActiveItems(input: {
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  nowTimestamp?: string;
  runState?: CliRunState;
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): TranscriptItem[] {
  const visibleRuntimeEvents = input.runtimeEvents ?? [];
  const preferRuntimeSteps = visibleRuntimeEvents.length > 0;
  const hasActiveSubagentRuns = (input.subagentRuns ?? []).some((run) => run.status === 'running' || run.status === 'paused');
  const hasLiveSubagentRuntime = visibleRuntimeEvents.some((event) => (
    event.kind === 'agent'
    && isConcreteSubagentRuntimeEvent(event)
    && (
      (event.phase === 'start' && event.status === 'running')
      || (event.phase === 'update' && (event.status === 'running' || event.status === 'paused'))
    )
  ));
  const hasAnySubagentRuntime = visibleRuntimeEvents.some((event) => (
    event.kind === 'agent'
    && isConcreteSubagentRuntimeEvent(event)
  ));
  const suppressAssistantForSubagentTurn = Boolean(
    hasActiveSubagentRuns
    || (
      input.runState?.status === 'running'
      && (input.runState.phase === 'subagent_wait'
        || input.runState.phase === 'subagent_completion'
        || hasAnySubagentRuntime)
    )
  );
  const suppressInternalInteractionResponse = shouldSuppressActiveTurnInteractionPreamble(
    input.activeTurn?.responseRole,
    visibleRuntimeEvents,
  );
  const suppressPreRuntimeAssistantResponse = shouldSuppressAssistantTaskLaunchChatter(
    input.activeTurn?.responseBeforeRuntime,
    input.activeTurn?.responseRole,
    visibleRuntimeEvents,
    input.activeTurn?.pendingAgentLaunch,
    input.activeTurn?.suppressAgentLaunchResponse,
  );
  const suppressActiveTurnResponse = shouldSuppressAssistantTaskLaunchChatter(
    input.activeTurn?.response,
    input.activeTurn?.responseRole,
    visibleRuntimeEvents,
    input.activeTurn?.pendingAgentLaunch,
    input.activeTurn?.suppressAgentLaunchResponse,
  );
  const thinkingItem = input.activeTurn?.thinking && !hasLiveSubagentRuntime && !hasActiveSubagentRuns && !suppressAssistantForSubagentTurn
    ? [{
        id: `${input.activeTurn.id}-thinking`,
        role: 'system' as const,
        content: `💭 Thinking…\n${input.activeTurn.thinking.slice(-200)}`,
      }]
    : [];
  const runtimeItems = preferRuntimeSteps ? buildRuntimeEventItems(visibleRuntimeEvents, input.nowTimestamp) : [];
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
    && !hasLiveSubagentRuntime
    && !suppressAssistantForSubagentTurn
    && !suppressPreRuntimeAssistantResponse
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
        content: hasLiveSubagentRuntime || suppressAssistantForSubagentTurn || suppressActiveTurnResponse || suppressInternalInteractionResponse || input.activeTurn.suppressInteractionResponse
          ? ''
          : input.activeTurn.response,
      }]
    : [];
  const items: TranscriptItem[] = runtimeItems.length > 0
    ? [...promptAndResponseItems, ...preRuntimeAssistantItems, ...runtimeItems, ...currentAssistantItems]
    : [...promptAndResponseItems, ...currentAssistantItems];
  return items.filter((item) => item.content);
}

// ── hasTranscriptContent ──────────────────────────────────────────

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

/* eslint-disable react-hooks/refs */
import {useEffect, useRef, useMemo, useState} from 'react';
import {HumanMessage, type BaseMessage} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@/index';
import type {SubagentRunQuerySummary} from '@codara/types';
import {isSubagentInternalAssistantText} from '@/index';
import type {CliActiveTurn, CliNotice, CliRunState} from '../../app/view-state';
import {
  type SolidifiedItem,
  type TranscriptItem,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  buildCanonicalTranscriptFingerprint,
  createToolCallLookup,
  dedupeTrailingTranscriptItemsCoveredByRuntime,
  normalizeVisibleAssistantText,
} from './model';
import {readMessageText} from '@shared/messages';

export interface UseSolidifiedTranscriptInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
  runState?: CliRunState;
  subagentRuns?: readonly SubagentRunQuerySummary[];
}

export interface UseSolidifiedTranscriptOutput {
  solidifiedItems: SolidifiedItem[];
  activeItems: TranscriptItem[];
}

export function filterSubagentCompletionTranscriptItems(input: {
  completedTurnKind: CliActiveTurn['kind'] | undefined;
  items: readonly TranscriptItem[];
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): TranscriptItem[] {
  void input.completedTurnKind;
  return stripInternalSubagentAssistantItems({
    items: input.items,
    subagentRuns: input.subagentRuns,
  });
}

export function orderActiveTranscriptItems(input: {
  trailingItems: readonly TranscriptItem[];
  runtimeItems: readonly TranscriptItem[];
  activeNoticeItems: readonly TranscriptItem[];
  latestCompletedTurnKind?: CliActiveTurn['kind'];
}): TranscriptItem[] {
  void input.latestCompletedTurnKind;
  if (input.runtimeItems.length === 0) {
    return [...input.trailingItems, ...input.activeNoticeItems];
  }

  let lastUserIndex = -1;
  for (let index = input.trailingItems.length - 1; index >= 0; index -= 1) {
    if (input.trailingItems[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  const insertionIndex = lastUserIndex >= 0 ? lastUserIndex + 1 : 0;
  return [
    ...input.trailingItems.slice(0, insertionIndex),
    ...input.runtimeItems,
    ...input.trailingItems.slice(insertionIndex),
    ...input.activeNoticeItems,
  ];
}

function filterTrailingAssistantItemsWhileSubagentsRun(input: {
  trailingItems: readonly TranscriptItem[];
  runtimeItems: readonly TranscriptItem[];
  activeTurn?: CliActiveTurn;
  runState?: CliRunState;
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): TranscriptItem[] {
  const subagentActive
    = (input.runState?.status === 'running'
        && (input.runState.phase === 'subagent_wait' || input.runState.phase === 'subagent_completion'))
    || (input.subagentRuns ?? []).some((run) => run.status === 'running' || run.status === 'paused')
    || input.runtimeItems.some((item) => item.role === 'agent' && item.toolMeta?.status === 'running');

  if (subagentActive) {
    return input.trailingItems.filter((item) => item.role !== 'assistant' && item.role !== 'system');
  }
  return [...input.trailingItems];
}

function stripInternalSubagentAssistantItems(input: {
  items: readonly TranscriptItem[];
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): TranscriptItem[] {
  const runs = input.subagentRuns ?? [];

  return input.items.filter((item) => {
    if (item.role !== 'assistant') {
      return true;
    }

    return !isSubagentInternalAssistantText({
      text: item.content,
      runs,
    });
  });
}

/**
 * Manages the solidified/active transcript split.
 *
 * Key behavior: the latest completed turn stays in the active (visible) area
 * until a NEW turn starts. This prevents all messages from immediately
 * scrolling into the scrollback buffer after each response.
 *
 * Flow:
 * 1. User sends prompt → activeTurn is created
 * 2. At that point, solidify all PRIOR coreMessages (push to Static/scrollback)
 * 3. Streaming happens → activeTurn shows prompt + response in active area
 * 4. Streaming ends → activeTurn cleared, coreMessages updated
 * 5. The just-completed turn's messages are NOT solidified yet — they become
 *    "trailing active items" built from coreMessages[lastSolidified..end]
 * 6. Next turn starts → go to step 1, solidify previous turn
 */
export function useSolidifiedTranscript(input: UseSolidifiedTranscriptInput): UseSolidifiedTranscriptOutput {
  const {coreMessages, notices, activeTurn, runtimeEvents, runState, subagentRuns} = input;
  const [now, setNow] = useState(() => Date.now());

  // Instance-level ID counter
  const idCounterRef = useRef(0);
  // Track how many coreMessages have been solidified
  const lastSolidifiedCountRef = useRef(0);
  // Track how many notices have been solidified
  const lastSolidifiedNoticeCountRef = useRef(0);
  // Append-only list of solidified items
  const solidifiedItemsRef = useRef<SolidifiedItem[]>([]);
  // Whether welcome has been emitted
  const welcomeEmittedRef = useRef(false);
  // Track previous activeTurn to detect transition
  const prevActiveTurnRef = useRef<CliActiveTurn | undefined>(undefined);
  const lastCompletedTurnKindRef = useRef<CliActiveTurn['kind'] | undefined>(undefined);
  const visibleAssistantTextsRef = useRef<Set<string>>(new Set());

  // Emit welcome item on first render
  if (!welcomeEmittedRef.current) {
    welcomeEmittedRef.current = true;
    solidifiedItemsRef.current = [
      ...solidifiedItemsRef.current,
      {
        id: `solid-welcome-${idCounterRef.current++}`,
        kind: 'welcome',
        items: [],
      },
    ];
  }

  // Solidify coreMessages — but ONLY when a new turn starts (activeTurn transitions from undefined → defined).
  // This keeps the latest completed turn visible in the active area.
  const previousActiveTurn = prevActiveTurnRef.current;
  const lastCompletedTurnKind = lastCompletedTurnKindRef.current;
  const newTurnStarted = activeTurn !== undefined && previousActiveTurn === undefined;
  if (activeTurn === undefined && previousActiveTurn !== undefined) {
    lastCompletedTurnKindRef.current = previousActiveTurn.kind;
  }
  if (newTurnStarted) {
    lastCompletedTurnKindRef.current = undefined;
  }
  prevActiveTurnRef.current = activeTurn;

  if (newTurnStarted && coreMessages.length > lastSolidifiedCountRef.current) {
    const toolLookup = createToolCallLookup(coreMessages);
    const solidifyEndIndex = resolveSolidifyEndIndex({
      coreMessages,
      startIndex: lastSolidifiedCountRef.current,
      activeTurn,
    });
    const newItems = buildSolidifiedItemsFromRange(
      coreMessages,
      lastSolidifiedCountRef.current,
      solidifyEndIndex,
      toolLookup,
      visibleAssistantTextsRef.current,
      subagentRuns,
    );
    const filteredNewItems = filterSubagentCompletionTranscriptItems({
      completedTurnKind: lastCompletedTurnKind,
      items: newItems,
      subagentRuns,
    });
    if (filteredNewItems.length > 0) {
      solidifiedItemsRef.current = [
        ...solidifiedItemsRef.current,
        {
          id: `solid-turn-${idCounterRef.current++}`,
          kind: 'turn',
          items: filteredNewItems,
        },
      ];
    }
    lastSolidifiedCountRef.current = solidifyEndIndex;
  }

  if (newTurnStarted && notices.length > lastSolidifiedNoticeCountRef.current) {
    const newNotices = notices.slice(lastSolidifiedNoticeCountRef.current);
    const noticeItems: TranscriptItem[] = newNotices
      .map((notice) => ({
        id: notice.id,
        role: notice.level,
        content: notice.content,
      }))
      .filter((item) => item.content);
    if (noticeItems.length > 0) {
      solidifiedItemsRef.current = [
        ...solidifiedItemsRef.current,
        {
          id: `solid-notice-${idCounterRef.current++}`,
          kind: 'notice',
          items: noticeItems,
        },
      ];
    }
    lastSolidifiedNoticeCountRef.current = notices.length;
  }

  // Build active items: activeTurn (if streaming) + un-solidified coreMessages + runtime events
  const solidifiedCount = lastSolidifiedCountRef.current;
  const activeItems = useMemo(() => {
    // Un-solidified coreMessages (the latest completed turn that hasn't been pushed to Static yet)
    const trailingItems: TranscriptItem[] = [];
    if (solidifiedCount < coreMessages.length) {
      const toolLookup = createToolCallLookup(coreMessages);
      trailingItems.push(...filterSubagentCompletionTranscriptItems({
        completedTurnKind: lastCompletedTurnKindRef.current,
        items: buildSolidifiedItemsFromRange(
          coreMessages,
          solidifiedCount,
          coreMessages.length,
          toolLookup,
          visibleAssistantTextsRef.current,
          subagentRuns,
        ),
        subagentRuns,
      }));
    }

    // Current streaming turn + runtime events
    const runtimeAndStreamingItems = buildActiveItems({
      activeTurn,
      runtimeEvents,
      nowTimestamp: new Date(now).toISOString(),
      runState,
      subagentRuns,
    });

    const activeNoticeItems: TranscriptItem[] = notices
      .slice(lastSolidifiedNoticeCountRef.current)
      .map((notice) => ({
        id: notice.id,
        role: notice.level,
        content: notice.content,
      }))
      .filter((item) => item.content);

    const dedupedTrailingItems = stripInternalSubagentAssistantItems({
      items: filterTrailingAssistantItemsWhileSubagentsRun({
        trailingItems: dedupeTrailingTranscriptItemsCoveredByRuntime(
          dedupeTrailingTranscriptItemsCoveredByActiveTurn(trailingItems, activeTurn),
          runtimeAndStreamingItems,
        ),
        runtimeItems: runtimeAndStreamingItems,
        activeTurn,
        runState,
        subagentRuns,
      }),
      subagentRuns,
    });

    const orderedItems = orderActiveTranscriptItems({
      trailingItems: dedupedTrailingItems,
      runtimeItems: runtimeAndStreamingItems,
      activeNoticeItems,
      latestCompletedTurnKind: lastCompletedTurnKindRef.current,
    });

    const solidifiedFingerprints = new Set(
      solidifiedItemsRef.current
        .flatMap((item) => item.items)
        .map(buildCanonicalTranscriptFingerprint)
        .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
    );

    return orderedItems.filter((item) => {
      const fingerprint = buildCanonicalTranscriptFingerprint(item);
      return !fingerprint || !solidifiedFingerprints.has(fingerprint);
    });
  }, [activeTurn, coreMessages, notices, now, runState, runtimeEvents, solidifiedCount, subagentRuns]);

  useEffect(() => {
    const visibleAssistantItems = activeItems.filter((item) => item.role === 'assistant' && item.content.trim());
    if (visibleAssistantItems.length === 0) {
      return;
    }

    for (const item of visibleAssistantItems) {
      visibleAssistantTextsRef.current.add(normalizeVisibleAssistantText(item.content));
    }

    while (visibleAssistantTextsRef.current.size > 50) {
      const oldest = visibleAssistantTextsRef.current.values().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      visibleAssistantTextsRef.current.delete(oldest);
    }
  }, [activeItems]);

  useEffect(() => {
    const endedIds = new Set(
      (runtimeEvents ?? [])
        .filter((event) => event.phase === 'end' && event.parentId)
        .map((event) => event.parentId as string),
    );
    const hasRunningRuntimeItem = (runtimeEvents ?? []).some((event) => {
      if (event.phase === 'update' && event.status === 'running') {
        return true;
      }
      if (event.phase !== 'start') {
        return false;
      }
      return !endedIds.has(event.id);
    });
    if (!hasRunningRuntimeItem) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [runtimeEvents]);

  return {
    solidifiedItems: solidifiedItemsRef.current,
    activeItems,
  };
}

function activeTurnOwnsVisibleTranscript(activeTurn: CliActiveTurn | undefined): boolean {
  if (!activeTurn) {
    return false;
  }

  return Boolean(
    activeTurn.prompt.trim()
    || activeTurn.responseBeforeRuntime?.trim()
    || activeTurn.response.trim()
    || activeTurn.pendingResponse?.trim(),
  );
}

function dedupeTrailingTranscriptItemsCoveredByActiveTurn(
  trailingItems: readonly TranscriptItem[],
  activeTurn: CliActiveTurn | undefined,
): TranscriptItem[] {
  if (!activeTurn) {
    return [...trailingItems];
  }

  const pendingFingerprints = new Map<string, number>();
  const track = (role: TranscriptItem['role'], content: string | undefined) => {
    const normalized = normalizeTranscriptFingerprintContent(content);
    if (!normalized) {
      return;
    }
    const key = `${role}|${normalized}`;
    pendingFingerprints.set(key, (pendingFingerprints.get(key) ?? 0) + 1);
  };

  track('user', activeTurn.prompt);
  track(activeTurn.responseRole, activeTurn.responseBeforeRuntime);
  track(activeTurn.responseRole, activeTurn.response);
  track(activeTurn.responseRole, activeTurn.pendingResponse);

  if (pendingFingerprints.size === 0) {
    return [...trailingItems];
  }

  return trailingItems.filter((item) => {
    if (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'system') {
      return true;
    }

    const normalized = normalizeTranscriptFingerprintContent(item.content);
    if (!normalized) {
      return true;
    }

    const key = `${item.role}|${normalized}`;
    const remaining = pendingFingerprints.get(key) ?? 0;
    if (remaining <= 0) {
      return true;
    }

    pendingFingerprints.set(key, remaining - 1);
    return false;
  });
}

function normalizeTranscriptFingerprintContent(content: string | undefined): string | undefined {
  const normalized = content?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function resolveSolidifyEndIndex(input: {
  coreMessages: readonly BaseMessage[];
  startIndex: number;
  activeTurn?: CliActiveTurn;
}): number {
  const {coreMessages, startIndex, activeTurn} = input;
  if (!activeTurn) {
    return coreMessages.length;
  }

  if (!activeTurnOwnsVisibleTranscript(activeTurn)) {
    for (let index = coreMessages.length - 1; index >= startIndex; index -= 1) {
      const message = coreMessages[index];
      if (message && HumanMessage.isInstance(message)) {
        return index;
      }
    }
    return coreMessages.length;
  }

  const prompt = activeTurn.prompt.trim();
  if (!prompt) {
    return coreMessages.length;
  }

  for (let index = coreMessages.length - 1; index >= startIndex; index -= 1) {
    const message = coreMessages[index];
    if (!message || !HumanMessage.isInstance(message)) {
      continue;
    }

    const content = readMessageText(message)?.trim();
    if (content === prompt) {
      return index;
    }
  }

  return coreMessages.length;
}

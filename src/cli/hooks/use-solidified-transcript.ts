/* eslint-disable react-hooks/refs */
import {useEffect, useRef, useMemo, useState} from 'react';
import type {BaseMessage} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@/index';
import type {CliActiveTurn, CliNotice} from '../app/view-state';
import {
  type SolidifiedItem,
  type TranscriptItem,
  buildSolidifiedItemsFromRange,
  buildActiveItems,
  createToolCallLookup,
} from '../transcript/model';

export interface UseSolidifiedTranscriptInput {
  coreMessages: readonly BaseMessage[];
  notices: readonly CliNotice[];
  activeTurn?: CliActiveTurn;
  runtimeEvents?: readonly CodaraRuntimeEvent[];
}

export interface UseSolidifiedTranscriptOutput {
  solidifiedItems: SolidifiedItem[];
  activeItems: TranscriptItem[];
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
  const {coreMessages, notices, activeTurn, runtimeEvents} = input;
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
  const newTurnStarted = activeTurn !== undefined && prevActiveTurnRef.current === undefined;
  prevActiveTurnRef.current = activeTurn;

  if (newTurnStarted && coreMessages.length > lastSolidifiedCountRef.current) {
    const toolLookup = createToolCallLookup(coreMessages);
    const newItems = buildSolidifiedItemsFromRange(
      coreMessages,
      lastSolidifiedCountRef.current,
      coreMessages.length,
      toolLookup,
    );
    if (newItems.length > 0) {
      solidifiedItemsRef.current = [
        ...solidifiedItemsRef.current,
        {
          id: `solid-turn-${idCounterRef.current++}`,
          kind: 'turn',
          items: newItems,
        },
      ];
    }
    lastSolidifiedCountRef.current = coreMessages.length;
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
      trailingItems.push(...buildSolidifiedItemsFromRange(
        coreMessages,
        solidifiedCount,
        coreMessages.length,
        toolLookup,
      ));
    }

    // Current streaming turn + runtime events
    const streamingItems = buildActiveItems({
      activeTurn,
      runtimeEvents,
      nowTimestamp: new Date(now).toISOString(),
    });

    const activeNoticeItems: TranscriptItem[] = notices
      .slice(lastSolidifiedNoticeCountRef.current)
      .map((notice) => ({
        id: notice.id,
        role: notice.level,
        content: notice.content,
      }))
      .filter((item) => item.content);

    return [...trailingItems, ...streamingItems, ...activeNoticeItems];
  }, [activeTurn, coreMessages, notices, now, runtimeEvents, solidifiedCount]);

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

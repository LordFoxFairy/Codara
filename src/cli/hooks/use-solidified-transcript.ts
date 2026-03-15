import {useRef, useMemo} from 'react';
import type {BaseMessage} from '@langchain/core/messages';
import type {CodaraRuntimeEvent} from '@core';
import type {CliActiveTurn, CliNotice} from '../app/view-state';
import type {CliLayoutMode} from '../app/layout-mode';
import type {RecentSession} from '../components/conversation/welcome-state';
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
  layoutMode: CliLayoutMode;
  cwd?: string;
  modelAlias?: string;
  recentSessions?: RecentSession[];
}

export interface UseSolidifiedTranscriptOutput {
  solidifiedItems: SolidifiedItem[];
  activeItems: TranscriptItem[];
}

export function useSolidifiedTranscript(input: UseSolidifiedTranscriptInput): UseSolidifiedTranscriptOutput {
  const {coreMessages, notices, activeTurn, runtimeEvents, layoutMode, cwd, modelAlias, recentSessions} = input;

  // Instance-level ID counter (replaces module-level nextSolidId)
  const idCounterRef = useRef(0);
  // Track how many coreMessages have been solidified
  const lastSolidifiedCountRef = useRef(0);
  // Track how many notices have been solidified
  const lastSolidifiedNoticeCountRef = useRef(0);
  // Append-only list of solidified items
  const solidifiedItemsRef = useRef<SolidifiedItem[]>([]);
  // Whether welcome has been emitted
  const welcomeEmittedRef = useRef(false);

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

  // Solidify new notices
  if (notices.length > lastSolidifiedNoticeCountRef.current) {
    const newNotices = notices.slice(lastSolidifiedNoticeCountRef.current);
    const noticeItems: TranscriptItem[] = newNotices.map((notice) => ({
      id: notice.id,
      role: notice.level,
      content: notice.content,
    }));
    const filteredNoticeItems = noticeItems.filter((item) => item.content);
    if (filteredNoticeItems.length > 0) {
      solidifiedItemsRef.current = [
        ...solidifiedItemsRef.current,
        {
          id: `solid-notice-${idCounterRef.current++}`,
          kind: 'notice',
          items: filteredNoticeItems,
        },
      ];
    }
    lastSolidifiedNoticeCountRef.current = notices.length;
  }

  // Solidify completed coreMessages (new messages beyond what we've already solidified)
  if (coreMessages.length > lastSolidifiedCountRef.current) {
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

  // Build active items from activeTurn + runtimeEvents
  const activeItems = useMemo(
    () => buildActiveItems({activeTurn, runtimeEvents}),
    [activeTurn, runtimeEvents],
  );

  return {
    solidifiedItems: solidifiedItemsRef.current,
    activeItems,
  };
}

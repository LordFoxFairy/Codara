/**
 * Pure helpers consumed by `use-solidify.ts` — ordering, dedup, filtering and
 * fingerprint logic for splitting the transcript into solidified/active halves.
 */
import {HumanMessage, type BaseMessage} from '@langchain/core/messages';
import {isSubagentInternalAssistantText} from '@/index';
import type {SubagentRunQuerySummary} from '@codara/types';
import type {CliActiveTurn, CliRunState} from '../../app/view-state';
import {readMessageText} from '@shared/messages';
import type {TranscriptItem} from './model';

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

export function filterTrailingAssistantItemsWhileSubagentsRun(input: {
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

export function stripInternalSubagentAssistantItems(input: {
  items: readonly TranscriptItem[];
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): TranscriptItem[] {
  const runs = input.subagentRuns ?? [];
  return input.items.filter((item) => {
    if (item.role !== 'assistant') return true;
    return !isSubagentInternalAssistantText({text: item.content, runs});
  });
}

export function activeTurnOwnsVisibleTranscript(activeTurn: CliActiveTurn | undefined): boolean {
  if (!activeTurn) return false;
  return Boolean(
    activeTurn.prompt.trim()
    || activeTurn.responseBeforeRuntime?.trim()
    || activeTurn.response.trim()
    || activeTurn.pendingResponse?.trim(),
  );
}

export function dedupeTrailingTranscriptItemsCoveredByActiveTurn(
  trailingItems: readonly TranscriptItem[],
  activeTurn: CliActiveTurn | undefined,
): TranscriptItem[] {
  if (!activeTurn) return [...trailingItems];

  const pendingFingerprints = new Map<string, number>();
  const track = (role: TranscriptItem['role'], content: string | undefined) => {
    const normalized = normalizeTranscriptFingerprintContent(content);
    if (!normalized) return;
    const key = `${role}|${normalized}`;
    pendingFingerprints.set(key, (pendingFingerprints.get(key) ?? 0) + 1);
  };

  track('user', activeTurn.prompt);
  track(activeTurn.responseRole, activeTurn.responseBeforeRuntime);
  track(activeTurn.responseRole, activeTurn.response);
  track(activeTurn.responseRole, activeTurn.pendingResponse);

  if (pendingFingerprints.size === 0) return [...trailingItems];

  return trailingItems.filter((item) => {
    if (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'system') {
      return true;
    }
    const normalized = normalizeTranscriptFingerprintContent(item.content);
    if (!normalized) return true;
    const key = `${item.role}|${normalized}`;
    const remaining = pendingFingerprints.get(key) ?? 0;
    if (remaining <= 0) return true;
    pendingFingerprints.set(key, remaining - 1);
    return false;
  });
}

function normalizeTranscriptFingerprintContent(content: string | undefined): string | undefined {
  const normalized = content?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

export function resolveSolidifyEndIndex(input: {
  coreMessages: readonly BaseMessage[];
  startIndex: number;
  activeTurn?: CliActiveTurn;
}): number {
  const {coreMessages, startIndex, activeTurn} = input;
  if (!activeTurn) return coreMessages.length;

  if (!activeTurnOwnsVisibleTranscript(activeTurn)) {
    for (let index = coreMessages.length - 1; index >= startIndex; index -= 1) {
      const message = coreMessages[index];
      if (message && HumanMessage.isInstance(message)) return index;
    }
    return coreMessages.length;
  }

  const prompt = activeTurn.prompt.trim();
  if (!prompt) return coreMessages.length;

  for (let index = coreMessages.length - 1; index >= startIndex; index -= 1) {
    const message = coreMessages[index];
    if (!message || !HumanMessage.isInstance(message)) continue;
    const content = readMessageText(message)?.trim();
    if (content === prompt) return index;
  }

  return coreMessages.length;
}

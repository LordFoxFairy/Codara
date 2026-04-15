/** @future — Pure controller logic for the next CLI architecture rewrite. Extracted from use-cli-controller for testability. */
import type {Codara, CodaraRuntimeEvent} from '@/index';
import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import type {ReviewRequest} from '@core/agent';
import type {SubagentRunQuerySummary} from '@codara/types';
import {isSubagentInternalAssistantText} from '@capability/subagent/completion';
import {readVisibleMessageText} from '@shared/messages';
import {containsAgentLaunchChatter} from './interaction-turn';
import {readCliReviewProjection} from './runtime-projection';
import type {
  CliActiveTurn,
  CliInteractionSurface,
  CliNotice,
  CliReviewState,
  CliRunState,
} from './view-state';

export const REVIEW_AUTO_ACTION_DELAY_MS = 30;
export const REVIEW_QUEUE_HANDOFF_TIMEOUT_MS = 500;
export const REVIEW_QUEUE_HANDOFF_POLL_MS = 10;
export const REVIEW_RESUME_READY_TIMEOUT_MS = 500;
export const REVIEW_RESUME_READY_POLL_MS = 10;
export const PROMPT_SETTLE_REFRESH_TIMEOUT_MS = 500;
export const PROMPT_SETTLE_REFRESH_POLL_MS = 20;

export function appendUniqueNotices(current: CliNotice[], incoming: readonly CliNotice[]): CliNotice[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((notice) => notice.id));
  const unique = incoming.filter((notice) => !seen.has(notice.id));
  return unique.length > 0 ? [...current, ...unique] : current;
}

export function deriveRunStateFromAgentState(nextAgentState: {status: string; pendingReview?: unknown}): CliRunState {
  if (nextAgentState.pendingReview || nextAgentState.status === 'paused') {
    return {status: 'paused'};
  }

  if (nextAgentState.status === 'running') {
    return {status: 'running'};
  }

  return {status: 'done'};
}

export function hasTrackedForegroundSubagentRuns(codara: Pick<Codara, 'getSubagentRunSummaries'>): boolean {
  return codara.getSubagentRunSummaries().some((run) => run.status === 'running' || run.status === 'paused');
}

export function shouldKeepPromptTurnRunningAfterAgentLaunch(input: {
  nextAgentState: {status: string};
  codara: Pick<Codara, 'getSubagentRunSummaries'>;
  launchedAgent: boolean;
  sawVisibleReply: boolean;
}): boolean {
  // Foreground subagents still running — always wait for them.
  if (hasTrackedForegroundSubagentRuns(input.codara)) {
    return true;
  }

  // An agent was launched: keep running unless a visible main reply already exists.
  // Subagents may not be registered in getSubagentRunSummaries yet (async startup),
  // so we hand off to the useEffect polling loop which confirms completion via
  // refreshCoreState() instead of relying on stale snapshots here.
  if (input.launchedAgent && !input.sawVisibleReply) {
    return true;
  }

  // No agent launched (plain tool call): if the main loop already produced a visible
  // reply, the turn is effectively done — don't keep spinning.
  if (input.sawVisibleReply) {
    return false;
  }

  return input.nextAgentState.status === 'running';
}

export function hasVisibleMainAssistantText(
  text: string | undefined,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): boolean {
  const normalized = text?.trim();
  if (!normalized || containsAgentLaunchChatter(normalized)) {
    return false;
  }

  return !isSubagentInternalAssistantText({
    text: normalized,
    runs: subagentRuns,
  });
}

export function hasVisibleAssistantReply(
  turn: CliActiveTurn | undefined,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): boolean {
  if (!turn || turn.responseRole !== 'assistant') {
    return false;
  }

  return hasVisibleMainAssistantText(turn.responseBeforeRuntime, subagentRuns)
    || hasVisibleMainAssistantText(turn.response, subagentRuns)
    || hasVisibleMainAssistantText(turn.pendingResponse, subagentRuns);
}

export function activeTurnOwnsVisibleTranscript(
  turn: CliActiveTurn | undefined,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): boolean {
  if (!turn) {
    return false;
  }

  return hasVisibleAssistantReply(turn, subagentRuns) || Boolean(turn.thinking?.trim());
}

export function hasVisibleAssistantReplyInMessages(
  messages: readonly BaseMessage[],
  startIndex = 0,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): boolean {
  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const text = readVisibleMessageText(message);
    if (!text || containsAgentLaunchChatter(text)) {
      continue;
    }

    if (isSubagentInternalAssistantText({text, runs: subagentRuns})) {
      continue;
    }

    return true;
  }

  return false;
}

export function shouldContinuePollingForPromptSettlement(input: {
  runState: CliRunState;
  review: CliReviewState | undefined;
  activeTurn: CliActiveTurn | undefined;
  messages: readonly BaseMessage[];
  promptStartMessageCount: number;
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): boolean {
  if (input.runState.status !== 'running') {
    return false;
  }

  if (input.review) {
    return false;
  }

  return !hasVisibleAssistantReply(input.activeTurn, input.subagentRuns)
    && !hasVisibleAssistantReplyInMessages(input.messages, input.promptStartMessageCount, input.subagentRuns);
}

export function resolveHydratedCoreMessages(input: {
  incomingMessages: readonly BaseMessage[];
  currentMessages: readonly BaseMessage[];
  runState: CliRunState;
  review: CliReviewState | undefined;
  activeTurn: CliActiveTurn | undefined;
  promptStartMessageCount: number;
  subagentRuns?: readonly SubagentRunQuerySummary[];
}): readonly BaseMessage[] {
  if (input.incomingMessages.length > 0) {
    return input.incomingMessages;
  }

  if (input.currentMessages.length === 0) {
    return input.incomingMessages;
  }

  if (input.runState.status !== 'running' || input.review) {
    return input.incomingMessages;
  }

  const currentTurnHasVisibleReply = hasVisibleAssistantReply(input.activeTurn, input.subagentRuns)
    || hasVisibleAssistantReplyInMessages(input.currentMessages, input.promptStartMessageCount, input.subagentRuns);

  return currentTurnHasVisibleReply ? input.currentMessages : input.incomingMessages;
}

export function appendRuntimeEventPreservingOpenStarts(
  current: readonly CodaraRuntimeEvent[],
  event: CodaraRuntimeEvent,
): CodaraRuntimeEvent[] {
  const next = [...current, event];
  const terminalEvents = next.filter((candidate) => (
    (candidate.kind === 'tool' || candidate.kind === 'agent')
    && candidate.phase === 'end'
    && candidate.parentId
  ));
  const terminalParentIds = new Set(
    terminalEvents.map((candidate) => candidate.parentId as string),
  );
  const recentEvents = next.slice(-40);
  const retainedIds = new Set(recentEvents.map((candidate) => candidate.id));
  const recentTerminalParentIds = new Set(
    recentEvents
      .filter((candidate) => (
        (candidate.kind === 'tool' || candidate.kind === 'agent')
        && candidate.phase === 'end'
        && candidate.parentId
      ))
      .map((candidate) => candidate.parentId as string),
  );
  const openStarts = next.filter((candidate) => (
    (candidate.kind === 'tool' || candidate.kind === 'agent')
    && candidate.phase === 'start'
    && (!terminalParentIds.has(candidate.id) || recentTerminalParentIds.has(candidate.id))
    && !retainedIds.has(candidate.id)
  ));
  return [...openStarts, ...recentEvents];
}

export function resolveFocusedSurface(
  _current: CliInteractionSurface,
  review: CliReviewState | undefined,
): CliInteractionSurface {
  if (!review) {
    return 'prompt';
  }
  return 'review';
}

export function shouldHandoffForegroundTurnToReview(review: CliReviewState | undefined): boolean {
  return review?.request.action.toolName === 'AskUserQuestion';
}

export function suppressActiveTurnForReview(
  current: CliActiveTurn | undefined,
  review: CliReviewState | undefined,
): CliActiveTurn | undefined {
  if (!current || !shouldHandoffForegroundTurnToReview(review)) {
    return current;
  }

  return {
    ...current,
    responseBeforeRuntime: undefined,
    response: '',
    suppressInteractionResponse: true,
  };
}

export async function waitForForegroundReviewResumeReady(
  codara: Codara,
  reviewId: string,
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest}>,
): Promise<void> {
  const deadline = Date.now() + REVIEW_RESUME_READY_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const nextAgentState = await refreshCoreState();
    const activeReviewRequest = readCliReviewProjection(codara, {
      pendingReview: nextAgentState.pendingReview,
    }).activeReviewRequest;
    if (activeReviewRequest?.id !== reviewId) {
      return;
    }
    if (nextAgentState.status !== 'running') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, REVIEW_RESUME_READY_POLL_MS));
  }
}

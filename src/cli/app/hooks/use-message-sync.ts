/**
 * Hook: useMessageSync
 *
 * Manages message synchronization between the Codara core and the CLI UI.
 * Handles hydration, review projection, and prompt settlement polling.
 */
import {useCallback, useState} from 'react';
import type {Codara, SessionState, ReviewRequest} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {readCliReviewProjection, syncProjectedReview} from '../runtime-projection';
import {
  resolveHydratedCoreMessages,
  shouldContinuePollingForPromptSettlement,
  suppressActiveTurnForReview,
  PROMPT_SETTLE_REFRESH_TIMEOUT_MS,
  PROMPT_SETTLE_REFRESH_POLL_MS,
} from '../cli-controller-logic';
import type {CliInteractionScheduler} from '../interaction-scheduler';
import type {CliStore} from '../cli-store';
import type {
  CliActiveTurn,
  CliReviewState,
} from '../view-state';

export interface MessageSyncDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  store: CliStore;
  setReviewState: (input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined)) => void;
  setActiveTurn: (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => void;
  syncInteractionState: () => void;
  settleRunningPromptTurnIfReady: (messages?: readonly BaseMessage[]) => boolean;
  suppressSettlingDismissedReview: (candidate: CliReviewState | undefined, pendingReview?: ReviewRequest) => CliReviewState | undefined;
}

export interface MessageSyncResult {
  coreMessages: readonly BaseMessage[];
  sessionState: SessionState;
  setCoreMessages: (messages: readonly BaseMessage[]) => void;
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>;
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>;
  refreshCoreStateUntilPromptSettles: () => Promise<boolean>;
  refreshAuxiliaryState: () => void;
}

export function useMessageSync(deps: MessageSyncDeps): MessageSyncResult {
  const {
    codara,
    interactionScheduler,
    store,
    setReviewState,
    setActiveTurn,
    syncInteractionState,
    settleRunningPromptTurnIfReady,
    suppressSettlingDismissedReview,
  } = deps;

  const [coreMessages, setCoreMessagesState] = useState<readonly BaseMessage[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());

  const setCoreMessages = useCallback((messages: readonly BaseMessage[]) => {
    store.patch({coreMessages: messages});
    setCoreMessagesState(messages);
  }, [store]);

  const refreshAuxiliaryState = useCallback(() => {
    const s = store.getState();
    const projection = readCliReviewProjection(codara);
    const nextReview = suppressSettlingDismissedReview(syncProjectedReview(codara, s.review, {
      pendingReview: projection.activeReviewRequest,
    }), projection.activeReviewRequest);
    setSessionState(codara.getState());
    setReviewState(nextReview);
    setActiveTurn((current) => suppressActiveTurnForReview(current, nextReview));
    syncInteractionState();
  }, [codara, store, setActiveTurn, setReviewState, suppressSettlingDismissedReview, syncInteractionState]);

  const refreshCoreState = useCallback(async () => {
    const s = store.getState();
    const nextAgentState = await codara.hydrate();
    if (!nextAgentState.pendingReview) {
      const queuedReviews = codara.listReviewItems();
      const hasFocusedQueuedReview = queuedReviews.some((review) => review.isFocused);
      if (queuedReviews.length > 0 && !hasFocusedQueuedReview) {
        await codara.focusReview(queuedReviews[0]!.reviewId);
      }
    }
    const nextMessages = resolveHydratedCoreMessages({
      incomingMessages: nextAgentState.messages,
      currentMessages: s.coreMessages,
      runState: s.runState,
      review: s.review,
      activeTurn: s.activeTurn,
      promptStartMessageCount: s.promptStartMessageCount,
      subagentRuns: codara.getSubagentRunSummaries(),
    });
    setCoreMessages(nextMessages);
    setSessionState(codara.getState());
    const nextReview = suppressSettlingDismissedReview(syncProjectedReview(codara, s.review, {
      pendingReview: nextAgentState.pendingReview,
    }), nextAgentState.pendingReview);
    setReviewState(nextReview);
    setActiveTurn((current) => suppressActiveTurnForReview(current, nextReview));
    syncInteractionState();

    if (
      nextAgentState.status !== 'running'
      && !nextAgentState.pendingReview
    ) {
      settleRunningPromptTurnIfReady(nextMessages);
    }

    return {
      ...nextAgentState,
      messages: nextMessages,
    };
  }, [codara, store, setCoreMessages, setActiveTurn, setReviewState, settleRunningPromptTurnIfReady, suppressSettlingDismissedReview, syncInteractionState]);

  const refreshCoreStateUntilPromptSettles = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + PROMPT_SETTLE_REFRESH_TIMEOUT_MS;

    while (Date.now() <= deadline) {
      const nextAgentState = await refreshCoreState();
      if (settleRunningPromptTurnIfReady(nextAgentState.messages)) {
        return true;
      }

      const s = store.getState();
      if (!shouldContinuePollingForPromptSettlement({
        runState: s.runState,
        review: s.review,
        activeTurn: s.activeTurn,
        messages: nextAgentState.messages,
        promptStartMessageCount: s.promptStartMessageCount,
        subagentRuns: codara.getSubagentRunSummaries(),
      })) {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, PROMPT_SETTLE_REFRESH_POLL_MS));

      if (!interactionScheduler.isRunning()) {
        return false;
      }
    }

    return false;
  }, [codara, interactionScheduler, store, refreshCoreState, settleRunningPromptTurnIfReady]);

  return {
    coreMessages,
    sessionState,
    setCoreMessages,
    setSessionState,
    refreshCoreState,
    refreshCoreStateUntilPromptSettles,
    refreshAuxiliaryState,
  };
}

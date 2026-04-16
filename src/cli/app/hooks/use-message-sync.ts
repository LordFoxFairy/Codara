/**
 * Hook: useMessageSync
 *
 * Manages message synchronization between the Codara core and the CLI UI.
 * Handles hydration, review projection, and prompt settlement polling.
 */
import {useCallback, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState, ReviewRequest} from '@/index';
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
import type {
  CliActiveTurn,
  CliNotice,
  CliReviewState,
  CliRunState,
} from '../view-state';

export interface MessageSyncDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  reviewRef: React.MutableRefObject<CliReviewState | undefined>;
  activeTurnRef: React.MutableRefObject<CliActiveTurn | undefined>;
  coreMessagesRef: React.MutableRefObject<readonly BaseMessage[]>;
  runStateRef: React.MutableRefObject<CliRunState>;
  promptStartMessageCountRef: React.MutableRefObject<number>;
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
    reviewRef,
    activeTurnRef,
    coreMessagesRef,
    runStateRef,
    promptStartMessageCountRef,
    setReviewState,
    setActiveTurn,
    syncInteractionState,
    settleRunningPromptTurnIfReady,
    suppressSettlingDismissedReview,
  } = deps;

  const [coreMessages, setCoreMessagesState] = useState<readonly BaseMessage[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());

  const setCoreMessages = useCallback((messages: readonly BaseMessage[]) => {
    coreMessagesRef.current = messages;
    setCoreMessagesState(messages);
  }, [coreMessagesRef]);

  const refreshAuxiliaryState = useCallback(() => {
    const projection = readCliReviewProjection(codara);
    const nextReview = suppressSettlingDismissedReview(syncProjectedReview(codara, reviewRef.current, {
      pendingReview: projection.activeReviewRequest,
    }), projection.activeReviewRequest);
    setSessionState(codara.getState());
    setReviewState(nextReview);
    setActiveTurn((current) => suppressActiveTurnForReview(current, nextReview));
    syncInteractionState();
  }, [codara, setActiveTurn, setReviewState, suppressSettlingDismissedReview, syncInteractionState, reviewRef]);

  const refreshCoreState = useCallback(async () => {
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
      currentMessages: coreMessagesRef.current,
      runState: runStateRef.current,
      review: reviewRef.current,
      activeTurn: activeTurnRef.current,
      promptStartMessageCount: promptStartMessageCountRef.current,
      subagentRuns: codara.getSubagentRunSummaries(),
    });
    setCoreMessages(nextMessages);
    setSessionState(codara.getState());
    const nextReview = suppressSettlingDismissedReview(syncProjectedReview(codara, reviewRef.current, {
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
  }, [codara, activeTurnRef, coreMessagesRef, promptStartMessageCountRef, reviewRef, runStateRef, setActiveTurn, setCoreMessages, setReviewState, settleRunningPromptTurnIfReady, suppressSettlingDismissedReview, syncInteractionState]);

  const refreshCoreStateUntilPromptSettles = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + PROMPT_SETTLE_REFRESH_TIMEOUT_MS;

    while (Date.now() <= deadline) {
      const nextAgentState = await refreshCoreState();
      if (settleRunningPromptTurnIfReady(nextAgentState.messages)) {
        return true;
      }

      if (!shouldContinuePollingForPromptSettlement({
        runState: runStateRef.current,
        review: reviewRef.current,
        activeTurn: activeTurnRef.current,
        messages: nextAgentState.messages,
        promptStartMessageCount: promptStartMessageCountRef.current,
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
  }, [codara, activeTurnRef, interactionScheduler, promptStartMessageCountRef, refreshCoreState, reviewRef, runStateRef, settleRunningPromptTurnIfReady]);

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

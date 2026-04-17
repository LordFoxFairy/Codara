/**
 * Hook: useReviewMachine
 *
 * Manages the complete review state machine: review navigation, submission,
 * permission flow, auto-actions, and queued review responses.
 */
import {useCallback, useEffect, useRef} from 'react';
import type {Codara, ReviewRequest} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import {
  activateCliReviewFocusedSelection,
  advanceCliReviewToNextStep,
  isPermissionReviewState,
  prepareCliReviewSubmission,
  resolveCliReviewFocusedFooterAction,
  setPermissionStage,
  type CliReviewAutoAction,
} from './state-core';
import {
  appendInteractionText,
} from '../../app/interaction-turn';
import type {CliInteractionScheduler, QueuedReviewResponseInteraction} from '../../app/interaction-scheduler';
import {readCliReviewProjection, syncProjectedReview} from '../../app/runtime-projection';
import {takeNextScheduledInteraction} from '../../app/cli-interaction-queue';
import {
  deriveRunStateFromAgentState,
  waitForForegroundReviewResumeReady,
  appendUniqueNotices,
  REVIEW_AUTO_ACTION_DELAY_MS,
  REVIEW_QUEUE_HANDOFF_TIMEOUT_MS,
  REVIEW_QUEUE_HANDOFF_POLL_MS,
} from '../../app/cli-controller-logic';
import type {CliStore} from '../../app/cli-store';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliNotice,
  CliReviewState,
  CliRunState,
} from '../../app/view-state';
import {
  selectPreviousReviewActionUpdate,
  selectNextReviewActionUpdate,
  moveReviewLeftUpdate,
  moveReviewRightUpdate,
  toggleReviewFocusUpdate,
  activateReviewSelectionUpdate,
  insertReviewTextUpdate,
  insertReviewNewlineUpdate,
  backspaceReviewInputUpdate,
  focusReviewWindowAction,
  focusPromptWindowAction,
} from '../../app/cli-review-actions';
import type {CliInteractionState} from '../../app/view-state';

export interface ReviewMachineDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  reviewAutoActions: CliReviewAutoAction[];
  store: CliStore;
  review: CliReviewState | undefined;
  runState: CliRunState;
  setReviewState: (input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined)) => void;
  setActiveTurn: (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => void;
  setRunState: (input: CliRunState | ((current: CliRunState) => CliRunState)) => void;
  setInteractionState: React.Dispatch<React.SetStateAction<CliInteractionState>>;
  beginInteraction: (kind: CliInteractionKind) => void;
  endInteraction: () => void;
  enqueueReviewResponse: (interaction: Omit<QueuedReviewResponseInteraction, 'kind'>) => void;
  syncInteractionState: () => void;
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  reportError: (error: unknown) => string;
  flushPendingBackgroundNotices: () => void;
  drainScheduledInteractions: () => void;
}

export interface ReviewMachineResult {
  // Navigation
  focusReviewWindow: () => void;
  focusPromptWindow: () => void;
  selectPreviousReviewAction: () => void;
  selectNextReviewAction: () => void;
  selectPreviousReview: () => void;
  selectNextReview: () => void;
  moveReviewLeft: () => void;
  moveReviewRight: () => void;
  toggleReviewFocus: () => void;
  activateReviewSelection: () => void;
  // Text input
  insertReviewText: (input: string) => void;
  insertReviewNewline: () => void;
  backspaceReviewInput: () => void;
  // Submission
  submitReviewAction: () => void;
  quickReviewAction: (actionId: string) => void;
  // Permission flow
  permissionBack: () => void;
  permissionConfirm: () => void;
  permissionRejectSend: () => void;
  permissionRejectSilent: () => void;
  // Queued review handling
  runQueuedReviewResponse: (interaction: QueuedReviewResponseInteraction) => Promise<boolean>;
  // Internal: used by useMessageSync
  suppressSettlingDismissedReview: (candidate: CliReviewState | undefined, pendingReview?: ReviewRequest) => CliReviewState | undefined;
}

export function useReviewMachine(deps: ReviewMachineDeps): ReviewMachineResult {
  const {
    codara,
    interactionScheduler,
    reviewAutoActions,
    store,
    review,
    runState,
    setReviewState,
    setActiveTurn,
    setRunState,
    setInteractionState,
    beginInteraction,
    endInteraction,
    enqueueReviewResponse,
    syncInteractionState,
    refreshCoreState,
    appendNotice,
    reportError,
    flushPendingBackgroundNotices,
    drainScheduledInteractions,
  } = deps;

  const autoActionsRef = useRef([...reviewAutoActions]);
  const handledAutoReviewIdsRef = useRef<Set<string>>(new Set());
  const settlingDismissedReviewIdRef = useRef<string | undefined>(undefined);

  // --- Navigation ---

  const focusReviewWindow = useCallback(() => {
    setInteractionState((current) => focusReviewWindowAction(current, !!store.getState().review));
  }, [store, setInteractionState]);

  const focusPromptWindow = useCallback(() => {
    setInteractionState((current) => focusPromptWindowAction(current, !!store.getState().review));
  }, [store, setInteractionState]);

  const selectPreviousReviewAction = useCallback(() => {
    setReviewState((current) => selectPreviousReviewActionUpdate(current));
  }, [setReviewState]);

  const selectNextReviewAction = useCallback(() => {
    setReviewState((current) => selectNextReviewActionUpdate(current));
  }, [setReviewState]);

  const shiftReviewFocus = useCallback(async (direction: -1 | 1) => {
    const reviews = codara.listReviewItems();
    if (reviews.length < 2) {
      return;
    }

    const currentReviewId = store.getState().review?.request.id;
    const currentIndex = reviews.findIndex((review) => review.reviewId === currentReviewId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + direction + reviews.length) % reviews.length;
    const nextReview = reviews[nextIndex];
    if (!nextReview) {
      return;
    }

    await codara.focusReview(nextReview.reviewId);
    await refreshCoreState();
  }, [codara, refreshCoreState, store]);

  const selectPreviousReview = useCallback(() => {
    void shiftReviewFocus(-1);
  }, [shiftReviewFocus]);

  const selectNextReview = useCallback(() => {
    void shiftReviewFocus(1);
  }, [shiftReviewFocus]);

  const moveReviewLeft = useCallback(() => {
    setReviewState((current) => moveReviewLeftUpdate(current));
  }, [setReviewState]);

  const moveReviewRight = useCallback(() => {
    setReviewState((current) => moveReviewRightUpdate(current));
  }, [setReviewState]);

  const toggleReviewFocus = useCallback(() => {
    setReviewState((current) => toggleReviewFocusUpdate(current));
  }, [setReviewState]);

  const activateReviewSelection = useCallback(() => {
    const result = activateReviewSelectionUpdate(store.getState().review);
    setReviewState(result.review);
    setRunState({status: 'paused'});
  }, [store, setReviewState, setRunState]);

  // --- Text input ---

  const insertReviewText = useCallback((input: string) => {
    setReviewState((current) => insertReviewTextUpdate(current, input));
  }, [setReviewState]);

  const insertReviewNewline = useCallback(() => {
    setReviewState((current) => insertReviewNewlineUpdate(current));
  }, [setReviewState]);

  const backspaceReviewInput = useCallback(() => {
    setReviewState((current) => backspaceReviewInputUpdate(current));
  }, [setReviewState]);

  // --- suppressSettlingDismissedReview (internal) ---

  const suppressSettlingDismissedReview = useCallback((
    candidate: CliReviewState | undefined,
    pendingReview?: ReviewRequest,
  ): CliReviewState | undefined => {
    const settlingReviewId = settlingDismissedReviewIdRef.current;
    if (!settlingReviewId) {
      return candidate;
    }

    const stillPresent = (
      codara.listReviewItems().some((item) => item.reviewId === settlingReviewId)
      || pendingReview?.id === settlingReviewId
    );

    if (!stillPresent) {
      settlingDismissedReviewIdRef.current = undefined;
      return candidate;
    }

    if (candidate?.request.id === settlingReviewId) {
      return undefined;
    }

    return candidate;
  }, [codara]);

  // --- Queued review response ---

  const runQueuedReviewResponse = useCallback(async (interaction: QueuedReviewResponseInteraction): Promise<boolean> => {
    const nextAgentState = await refreshCoreState();
    const activeForegroundReview = nextAgentState.pendingReview;
    if (activeForegroundReview && activeForegroundReview.id !== interaction.reviewId) {
      interactionScheduler.requeueInteraction(interaction);
      setRunState({status: 'paused'});
      syncInteractionState();
      return false;
    }

    const queuedReviewStillExists = codara.listReviewItems().some((review) => review.reviewId === interaction.reviewId);
    if (!queuedReviewStillExists && activeForegroundReview?.id !== interaction.reviewId) {
      setRunState(deriveRunStateFromAgentState(nextAgentState));
      syncInteractionState();
      return true;
    }

    beginInteraction('review_response');
    setRunState({status: 'running', phase: 'review_resume'});

    try {
      await waitForForegroundReviewResumeReady(codara, interaction.reviewId, refreshCoreState);
      await codara.focusReview(interaction.reviewId);

      const resumeStream = codara.streamInteraction({
        kind: 'review',
        payload: interaction.payload,
        config: {streamMode: 'messages'},
      });
      for await (const chunk of resumeStream) {
        if (!AIMessageChunk.isInstance(chunk)) {
          continue;
        }
        const text = chunk.text;
        if (text) {
          setActiveTurn((current) => appendInteractionText(current, text, {
            id: `turn-resume-${Date.now()}`,
            prompt: '',
            responseRole: 'assistant',
          }));
        }
      }

      setActiveTurn(undefined);
      const postAgentState = await refreshCoreState();
      setRunState(postAgentState.pendingReview || postAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
    }
    return true;
  }, [beginInteraction, codara, endInteraction, interactionScheduler, refreshCoreState, reportError, setActiveTurn, setRunState, syncInteractionState]);

  // --- submitReviewAction (core) ---

  const submitReviewActionImpl = useCallback(async (autoAction?: CliReviewAutoAction) => {
    const currentReview = store.getState().review ?? review;
    if (!currentReview) {
      return;
    }

    if (!autoAction && currentReview.form && currentReview.focus !== 'actions') {
      const activated = activateCliReviewFocusedSelection(currentReview);
      if (activated) {
        setReviewState(activated);
        setRunState({status: 'paused'});
      }
      return;
    }

    if (!autoAction && currentReview.form && !currentReview.form.endStep && currentReview.focus === 'actions') {
      const footerAction = resolveCliReviewFocusedFooterAction(currentReview);
      if (footerAction?.id === 'next') {
        const advanced = advanceCliReviewToNextStep(currentReview);
        setReviewState(advanced);
        setRunState({status: 'paused'});
        return;
      }
    }

    const prepared = prepareCliReviewSubmission(currentReview, autoAction);
    if (!prepared.payload) {
      setReviewState(prepared.review);
      setRunState({status: 'paused'});
      return;
    }

    const focusedReview = codara.getFocusedReview();
    const reviewMatchesCurrentReview = focusedReview?.request.id === prepared.review.request.id;

    if (interactionScheduler.isRunning()) {
      const busyReview = {...prepared.review, busy: true};
      setReviewState(busyReview);
      enqueueReviewResponse({
        reviewId: prepared.review.request.id,
        payload: prepared.payload,
      });
      return;
    }

    beginInteraction('review_response');
    setRunState({status: 'running', phase: 'review_resume'});

    try {
      const selectedAction = autoAction
        ? prepared.review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
        : prepared.review.actions[prepared.review.selectedActionIndex];
      if (!prepared.review.form && !isPermissionReviewState(prepared.review)) {
        appendNotice('system', `Review action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }

      if (reviewMatchesCurrentReview) {
        const queuedReviewCount = codara.listReviewItems().length;
        if (queuedReviewCount <= 1) {
          settlingDismissedReviewIdRef.current = prepared.review.request.id;
          setReviewState(undefined);
          syncInteractionState();

          const resumeStream = codara.streamInteraction({
            kind: 'review',
            payload: prepared.payload,
            config: {streamMode: 'messages'},
          });
          for await (const chunk of resumeStream) {
            if (!AIMessageChunk.isInstance(chunk)) {
              continue;
            }
            const text = chunk.text;
            if (text) {
              setActiveTurn((current) => appendInteractionText(current, text, {
                id: `turn-review-${Date.now()}`,
                prompt: '',
                responseRole: 'assistant',
              }));
            }
          }

          setActiveTurn(undefined);
          const nextAgentState = await refreshCoreState();
          setRunState(nextAgentState.pendingReview || nextAgentState.status === 'paused'
            ? {status: 'paused'}
            : {status: 'done'});
          return;
        }

        const s = store.getState();
        const busyReview = s.review?.request.id === prepared.review.request.id
          ? {...s.review, busy: true}
          : {...prepared.review, busy: true};
        setReviewState(busyReview);
        void (async () => {
          try {
            const currentReviewId = prepared.review.request.id;
            void codara.resumeReview(prepared.payload, {streamMode: 'messages'}).catch((error) => {
              reportError(error);
            });

            const deadline = Date.now() + REVIEW_QUEUE_HANDOFF_TIMEOUT_MS;
            while (Date.now() <= deadline) {
              const nextAgentState = await refreshCoreState();
              const reviews = codara.listReviewItems();
              const activeReviewRequest = readCliReviewProjection(codara, {
                pendingReview: nextAgentState.pendingReview,
              }).activeReviewRequest;
              const stillShowingCurrent = reviews.some((review) => review.reviewId === currentReviewId);
              if (!stillShowingCurrent) {
                const s2 = store.getState();
                const nextReview = syncProjectedReview(codara, s2.review, {pendingReview: activeReviewRequest});
                setReviewState(nextReview);
                syncInteractionState();
                setRunState(deriveRunStateFromAgentState(nextAgentState));
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, REVIEW_QUEUE_HANDOFF_POLL_MS));
            }

            const nextAgentState = await refreshCoreState();
            setRunState(deriveRunStateFromAgentState(nextAgentState));
          } catch (error) {
            reportError(error);
            await refreshCoreState().catch(() => undefined);
          } finally {
            endInteraction();
            drainScheduledInteractions();
          }
        })();
        return;
      }

      await waitForForegroundReviewResumeReady(codara, prepared.review.request.id, refreshCoreState);
      await codara.focusReview(prepared.review.request.id);
      const resumeStream = codara.streamInteraction({
        kind: 'review',
        payload: prepared.payload,
        config: {streamMode: 'messages'},
      });
      for await (const chunk of resumeStream) {
        if (!AIMessageChunk.isInstance(chunk)) continue;
        const text = chunk.text;
        if (text) {
          setActiveTurn((current) => appendInteractionText(current, text, {
            id: `turn-resume-${Date.now()}`,
            prompt: '',
            responseRole: 'assistant',
          }));
        }
      }

      setActiveTurn(undefined);
      const nextAgentState = await refreshCoreState();
      setRunState(nextAgentState.pendingReview || nextAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
      drainScheduledInteractions();
    }
  }, [appendNotice, beginInteraction, codara, drainScheduledInteractions, endInteraction, enqueueReviewResponse, interactionScheduler, refreshCoreState, reportError, review, store, setActiveTurn, setReviewState, setRunState, syncInteractionState]);

  const submitReviewAction = useCallback(() => {
    void submitReviewActionImpl();
  }, [submitReviewActionImpl]);

  const quickReviewAction = useCallback((actionId: string) => {
    if (actionId === 'dont_ask_again') {
      setReviewState((current) => current ? setPermissionStage(current, 'always-confirm') : current);
      return;
    }
    if (actionId === 'deny') {
      setReviewState((current) => current ? setPermissionStage(current, 'reject-feedback') : current);
      return;
    }
    void submitReviewActionImpl({action: actionId});
  }, [setReviewState, submitReviewActionImpl]);

  const permissionBack = useCallback(() => {
    setReviewState((current) => current ? setPermissionStage(current, 'prompt') : current);
  }, [setReviewState]);

  const permissionConfirm = useCallback(() => {
    void submitReviewActionImpl({action: 'dont_ask_again'});
  }, [submitReviewActionImpl]);

  const permissionRejectSend = useCallback(() => {
    const currentReview = store.getState().review;
    if (!currentReview) return;
    void submitReviewActionImpl({action: 'deny', comment: currentReview.draft.trim() || undefined});
  }, [store, submitReviewActionImpl]);

  const permissionRejectSilent = useCallback(() => {
    void submitReviewActionImpl({action: 'deny'});
  }, [submitReviewActionImpl]);

  // --- Auto-actions effect ---

  useEffect(() => {
    if (!review || runState.status === 'running' || autoActionsRef.current.length === 0) {
      return;
    }

    if (handledAutoReviewIdsRef.current.has(review.request.id)) {
      return;
    }

    handledAutoReviewIdsRef.current.add(review.request.id);
    const nextAction = autoActionsRef.current.shift();
    if (!nextAction) {
      return;
    }

    const timer = setTimeout(() => {
      void submitReviewActionImpl(nextAction);
    }, REVIEW_AUTO_ACTION_DELAY_MS);

    return () => clearTimeout(timer);
  }, [review, runState.status, submitReviewActionImpl]);

  return {
    focusReviewWindow,
    focusPromptWindow,
    selectPreviousReviewAction,
    selectNextReviewAction,
    selectPreviousReview,
    selectNextReview,
    moveReviewLeft,
    moveReviewRight,
    toggleReviewFocus,
    activateReviewSelection,
    insertReviewText,
    insertReviewNewline,
    backspaceReviewInput,
    submitReviewAction,
    quickReviewAction,
    permissionBack,
    permissionConfirm,
    permissionRejectSend,
    permissionRejectSilent,
    runQueuedReviewResponse,
    suppressSettlingDismissedReview,
  };
}

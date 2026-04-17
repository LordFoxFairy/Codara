/**
 * Hook: useReviewMachine
 *
 * Manages the complete review state machine: review navigation, submission,
 * permission flow, auto-actions, and queued review responses. The heavy
 * async callbacks live in `machine-actions.ts`; the auto-action effect
 * lives in `machine-effects.ts`; this file stays focused on wiring those
 * pieces plus thin navigation/text callbacks together.
 */
import {useCallback, useMemo, useRef} from 'react';
import type {Codara, ReviewRequest} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {setPermissionStage, type CliReviewAutoAction} from './state-core';
import type {CliInteractionScheduler, QueuedReviewResponseInteraction} from '../../app/interaction-scheduler';
import type {CliStore} from '../../app/store';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliInteractionState,
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
} from '../../app/review-actions';
import {
  createSubmitReviewAction,
  createRunQueuedReviewResponse,
  createSuppressSettlingDismissedReview,
} from './machine-actions';
import {useReviewAutoActions} from './machine-effects';

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
    drainScheduledInteractions,
  } = deps;

  const autoActionsRef = useRef([...reviewAutoActions]);
  const handledAutoReviewIdsRef = useRef<Set<string>>(new Set());
  const settlingDismissedReviewIdRef = useRef<string | undefined>(undefined);

  // ── Navigation ────────────────────────────────────────────────────────

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

  // ── Text input ────────────────────────────────────────────────────────

  const insertReviewText = useCallback((input: string) => {
    setReviewState((current) => insertReviewTextUpdate(current, input));
  }, [setReviewState]);

  const insertReviewNewline = useCallback(() => {
    setReviewState((current) => insertReviewNewlineUpdate(current));
  }, [setReviewState]);

  const backspaceReviewInput = useCallback(() => {
    setReviewState((current) => backspaceReviewInputUpdate(current));
  }, [setReviewState]);

  // ── Submission / queued response / suppression ───────────────────────

  const suppressSettlingDismissedReview = useMemo(
    () => createSuppressSettlingDismissedReview({codara, settlingDismissedReviewIdRef}),
    [codara],
  );

  const actionDeps = useMemo(() => ({
    codara,
    interactionScheduler,
    store,
    review,
    setReviewState,
    setActiveTurn,
    setRunState,
    beginInteraction,
    endInteraction,
    enqueueReviewResponse,
    syncInteractionState,
    refreshCoreState,
    appendNotice,
    reportError,
    drainScheduledInteractions,
    settlingDismissedReviewIdRef,
  }), [
    appendNotice, beginInteraction, codara, drainScheduledInteractions, endInteraction,
    enqueueReviewResponse, interactionScheduler, refreshCoreState, reportError, review,
    store, setActiveTurn, setReviewState, setRunState, syncInteractionState,
  ]);

  const submitReviewActionImpl = useCallback(
    (autoAction?: CliReviewAutoAction) => createSubmitReviewAction(actionDeps)(autoAction),
    [actionDeps],
  );

  const runQueuedReviewResponse = useCallback(
    (interaction: QueuedReviewResponseInteraction) => createRunQueuedReviewResponse(actionDeps)(interaction),
    [actionDeps],
  );

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

  // ── Permission flow ──────────────────────────────────────────────────

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

  // ── Auto-actions effect ──────────────────────────────────────────────

  useReviewAutoActions({
    review,
    runState,
    autoActionsRef,
    handledAutoReviewIdsRef,
    submitReviewActionImpl,
  });

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

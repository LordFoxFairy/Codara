/**
 * Hook: useCliController
 *
 * Composes the four core CLI hooks (message sync, review machine, prompt
 * submission, runtime events) into a single CliController object consumed
 * by the shell UI. All mutable state, scheduling, and lifecycle orchestration
 * lives here so that the rendering layer stays declarative.
 *
 * Architecture: An external CliStore holds shared mutable state (replaces
 * the old "ref bridge" pattern). Hooks read/write via store.getState() /
 * store.patch() so circular dependencies are impossible.
 */
import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {
  createComposerState,
  insertComposerText,
  replaceComposerText,
  insertComposerNewline,
  backspaceComposerText,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUp,
  moveComposerCursorDown,
  moveComposerCursorHome,
  moveComposerCursorEnd,
  type CliComposerState,
} from '../composer/state';
import {hasTranscriptContent} from '../transcript/model';
import {
  toggleSubagentRunsPanelAction,
  toggleExpandAction,
  dismissCommandOutputAction,
  scrollCommandOutputAction,
} from './cli-review-actions';
import type {CliReviewAutoAction} from './review-state';
import {
  CliInteractionScheduler,
  type QueuedReviewResponseInteraction,
} from './interaction-scheduler';
import {resolveInteractionStateSnapshot} from './cli-interaction-queue';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliInteractionState,
  CliNotice,
  CliReviewState,
  CliRunState,
} from './view-state';
import {
  appendUniqueNotices,
  hasVisibleAssistantReplyInMessages,
  hasVisibleAssistantReply,
  activeTurnOwnsVisibleTranscript,
} from './cli-controller-logic';

// Composed hooks
import {useMessageSync} from './hooks/use-message-sync';
import {useRuntimeEvents} from './hooks/use-runtime-events';
import {useReviewMachine} from './hooks/use-review-machine';
import {usePromptSubmission} from './hooks/use-prompt-submission';

// External store
import {createCliStore, type CliStore} from './cli-store';

const STARTUP_MESSAGE = '';


export interface UseCliControllerOptions {
  codara: Codara;
  initialPrompt?: string;
  startupMessage?: string;
  reviewAutoActions?: CliReviewAutoAction[];
  reopenSession?: (sessionId: string) => Promise<void>;
  openFile?: (targetPath: string) => Promise<boolean>;
  onShowSessionPicker?: () => void;
}

export interface CliController {
  composer: CliComposerState;
  composerActivityVersion: number;
  notices: CliNotice[];
  commandOutput?: {content: string; commandName?: string; scrollOffset: number};
  dismissCommandOutput: () => void;
  scrollCommandOutput: (delta: number) => void;
  activeTurn?: CliActiveTurn;
  review?: CliReviewState;
  coreMessages: readonly BaseMessage[];
  runtimeEvents: readonly CodaraRuntimeEvent[];
  latestRuntimeEvent?: CodaraRuntimeEvent;
  hasConversation: boolean;
  runState: CliRunState;
  interactionState: CliInteractionState;
  sessionState: SessionState;
  subagentRunPanelVisible: boolean;
  toggleSubagentRunsPanel: () => void;
  expandedAll: boolean;
  toggleExpand: () => void;
  insertText: (input: string) => void;
  replaceText: (text: string) => void;
  insertNewline: () => void;
  backspace: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorUp: () => void;
  moveCursorDown: () => void;
  moveCursorHome: () => void;
  moveCursorEnd: () => void;
  submitDraft: () => void;
  submitText: (text: string) => void;
  focusReviewWindow: () => void;
  focusPromptWindow: () => void;
  moveReviewLeft: () => void;
  moveReviewRight: () => void;
  selectPreviousReviewAction: () => void;
  selectNextReviewAction: () => void;
  selectPreviousReview: () => void;
  selectNextReview: () => void;
  toggleReviewFocus: () => void;
  activateReviewSelection: () => void;
  insertReviewText: (input: string) => void;
  insertReviewNewline: () => void;
  backspaceReviewInput: () => void;
  submitReviewAction: () => void;
  quickReviewAction: (actionId: string) => void;
  permissionBack: () => void;
  permissionConfirm: () => void;
  permissionRejectSend: () => void;
  permissionRejectSilent: () => void;
}

export function useCliController(options: UseCliControllerOptions): CliController {
  const {
    codara,
    initialPrompt = '',
    startupMessage = STARTUP_MESSAGE,
    reviewAutoActions = [],
    reopenSession,
    openFile,
    onShowSessionPicker,
  } = options;

  // ─── External store (created once, stable reference) ──────────────
  const [store] = useState<CliStore>(() => createCliStore());

  // ─── Startup notices ───────────────────────────────────────────────
  const initialNotices = useMemo<CliNotice[]>(
    () => startupMessage.trim()
      ? [{
          id: `system-${randomUUID()}`,
          level: 'system',
          content: startupMessage.trim(),
        }]
      : [],
    [startupMessage],
  );
  const initialNoticeCount = initialNotices.length;

  // ─── React-driven UI state (triggers re-renders) ──────────────────
  const [composer, setComposer] = useState(() => createComposerState());
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [notices, setNotices] = useState<CliNotice[]>(initialNotices);
  const [activeTurn, setActiveTurnReact] = useState<CliActiveTurn | undefined>();
  const [review, setReviewReact] = useState<CliReviewState | undefined>();
  const [runState, setRunStateReact] = useState<CliRunState>({status: 'idle'});
  const [runningAgentCount, setRunningAgentCount] = useState(0);
  const [interactionState, setInteractionState] = useState<CliInteractionState>({
    focusedSurface: 'prompt',
    pendingCount: 0,
    promptBlocked: false,
  });
  const [subagentRunPanelVisible, setSubagentRunPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const [commandOutput, setCommandOutput] = useState<{content: string; commandName?: string; scrollOffset: number} | undefined>();

  // ─── Shared scheduler (stable reference) ──────────────────────────
  const interactionScheduler = useMemo(() => new CliInteractionScheduler(), []);


  // ─── Store-synced state setters ───────────────────────────────────
  // These update both React state (for re-renders) and the store (for
  // synchronous reads by callbacks). Created once — store is stable.

  const setReviewState = useMemo(() => (
    input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined),
  ) => {
    const next = typeof input === 'function'
      ? (input as (current: CliReviewState | undefined) => CliReviewState | undefined)(store.getState().review)
      : input;
    store.patch({review: next});
    setReviewReact(next);
  }, [store]);

  const setActiveTurn = useMemo(() => (
    input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined),
  ) => {
    const next = typeof input === 'function'
      ? (input as (current: CliActiveTurn | undefined) => CliActiveTurn | undefined)(store.getState().activeTurn)
      : input;
    store.patch({activeTurn: next});
    setActiveTurnReact(next);
  }, [store]);

  const setRunState = useMemo(() => (
    input: CliRunState | ((current: CliRunState) => CliRunState),
  ) => {
    const next = typeof input === 'function' ? input(store.getState().runState) : input;
    store.patch({runState: next});
    setRunStateReact(next);
  }, [store]);

  // ─── Interaction scheduling + notice helpers ──────────────────────
  // All created once. interactionScheduler and store are stable refs.

  const syncInteractionState = useMemo(() => () => {
    setInteractionState((current) =>
      resolveInteractionStateSnapshot(current, interactionScheduler, store.getState().review),
    );
  }, [interactionScheduler, store]);

  const beginInteraction = useMemo(() => (kind: CliInteractionKind) => {
    interactionScheduler.begin(kind);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const endInteraction = useMemo(() => () => {
    interactionScheduler.end();
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const enqueueSessionPrompt = useMemo(() => (prompt: string) => {
    interactionScheduler.enqueueSessionPrompt(prompt);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const enqueueReviewResponse = useMemo(() => (interaction: Omit<QueuedReviewResponseInteraction, 'kind'>) => {
    interactionScheduler.enqueueReviewResponse(interaction);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const appendNotice = useMemo(() => (level: CliNotice['level'], content: string) => {
    const message = content.trim();
    if (!message) return;
    setNotices((current) => [
      ...current,
      {id: `${level}-${randomUUID()}`, level, content: message},
    ]);
  }, []);

  const flushPendingBackgroundNotices = useMemo(() => () => {
    const s = store.getState();
    if (s.pendingBackgroundNotices.length === 0) return;
    const queued = s.pendingBackgroundNotices;
    store.patch({pendingBackgroundNotices: []});
    setNotices((current) => appendUniqueNotices(current, queued));
  }, [store]);

  const reportError = useMemo(() => (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setRunState({status: 'error', error: message});
    setActiveTurn(undefined);
    appendNotice('error', message);
    return message;
  }, [appendNotice, setActiveTurn, setRunState]);

  // ─── Settlement logic ──────────────────────────────────────────────
  const settleRunningPromptTurnIfReady = useMemo(() => (messages?: readonly BaseMessage[]): boolean => {
    const s = store.getState();
    if (s.runState.status !== 'running') return false;
    if (s.runState.phase === 'subagent_completion') return false;

    const hasVisibleReplyInMessagesNow = hasVisibleAssistantReplyInMessages(
      messages ?? s.coreMessages,
      s.promptStartMessageCount,
      codara.getSubagentRunSummaries(),
    );
    const hasVisibleReplyInActiveTurn = hasVisibleAssistantReply(
      s.activeTurn,
      codara.getSubagentRunSummaries(),
    );
    if (!hasVisibleReplyInMessagesNow && !hasVisibleReplyInActiveTurn) return false;

    store.patch({settlingFinalReply: true});
    setRunState({status: 'done'});
    if (hasVisibleReplyInMessagesNow) {
      setActiveTurn(undefined);
    }
    return true;
  }, [codara, setActiveTurn, setRunState, store]);

  // ─── Store-based function bridges ─────────────────────────────────
  // Stable wrappers that always delegate to store.getState().fn
  const refreshCoreStateBridge = useMemo(
    () => () => store.getState().refreshCoreState(),
    [store],
  );
  const drainScheduledInteractionsBridge = useMemo(
    () => () => store.getState().drainScheduledInteractions(),
    [store],
  );

  // ─── Compose: useReviewMachine ─────────────────────────────────────
  const reviewMachine = useReviewMachine({
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
    refreshCoreState: refreshCoreStateBridge,
    appendNotice,
    reportError,
    flushPendingBackgroundNotices,
    drainScheduledInteractions: drainScheduledInteractionsBridge,
  });

  // ─── Compose: useMessageSync ───────────────────────────────────────
  const messageSync = useMessageSync({
    codara,
    interactionScheduler,
    store,
    setReviewState,
    setActiveTurn,
    syncInteractionState,
    settleRunningPromptTurnIfReady,
    suppressSettlingDismissedReview: reviewMachine.suppressSettlingDismissedReview,
  });

  // Wire the function bridge for refreshCoreState
  store.patch({refreshCoreState: messageSync.refreshCoreState});

  // ─── Compose: usePromptSubmission ──────────────────────────────────
  const promptSubmission = usePromptSubmission({
    codara,
    interactionScheduler,
    initialPrompt,
    store,
    setActiveTurn,
    setRunState,
    setCommandOutput,
    setRuntimeEvents: ((v: React.SetStateAction<readonly CodaraRuntimeEvent[]>) => store.getState().clearRuntimeEvents(v)) as React.Dispatch<React.SetStateAction<readonly CodaraRuntimeEvent[]>>,
    sessionState: messageSync.sessionState,
    beginInteraction,
    endInteraction,
    enqueueSessionPrompt,
    syncInteractionState,
    refreshCoreState: messageSync.refreshCoreState,
    appendNotice,
    reportError,
    flushPendingBackgroundNotices,
    reopenSession,
    openFile,
    onShowSessionPicker,
    runQueuedReviewResponse: reviewMachine.runQueuedReviewResponse,
  });

  // Wire the function bridge for drainScheduledInteractions
  store.patch({drainScheduledInteractions: promptSubmission.drainScheduledInteractions});

  // ─── Compose: useRuntimeEvents ─────────────────────────────────────
  const runtimeEventsHook = useRuntimeEvents({
    codara,
    interactionScheduler,
    store,
    setActiveTurn,
    setNotices,
    setRunningAgentCount,
    setRunState,
    endInteraction,
    refreshAuxiliaryState: messageSync.refreshAuxiliaryState,
    refreshCoreState: messageSync.refreshCoreState,
    refreshCoreStateUntilPromptSettles: messageSync.refreshCoreStateUntilPromptSettles,
    settleRunningPromptTurnIfReady,
    drainScheduledInteractions: promptSubmission.drainScheduledInteractions,
  });

  // Wire the function bridge for clearRuntimeEvents
  store.patch({clearRuntimeEvents: runtimeEventsHook.clearRuntimeEvents});

  // ─── Agent count / run state effects ───────────────────────────────
  useEffect(() => {
    if (review) return;
    if (runningAgentCount > 0) {
      if (runState.status !== 'running' && !store.getState().settlingFinalReply) {
        setRunState({status: 'running', phase: 'prompt_stream'});
      }
    } else if (runState.status === 'running' && !interactionScheduler.isRunning() && runState.phase !== 'subagent_wait') {
      store.patch({settlingFinalReply: false});
      setRunState({status: 'done'});
    }
  }, [runningAgentCount, runState.status, runState.phase, review, interactionScheduler, store, setRunState]);

  useEffect(() => {
    settleRunningPromptTurnIfReady(messageSync.coreMessages);
  }, [messageSync.coreMessages, settleRunningPromptTurnIfReady]);

  useEffect(() => {
    if (runState.status !== 'done') return;
    if (!activeTurnOwnsVisibleTranscript(activeTurn, codara.getSubagentRunSummaries())) return;
    const s = store.getState();
    if (!hasVisibleAssistantReplyInMessages(messageSync.coreMessages, s.promptStartMessageCount, codara.getSubagentRunSummaries())) return;
    setActiveTurn(undefined);
  }, [activeTurn, codara, messageSync.coreMessages, runState.status, setActiveTurn, store]);

  useEffect(() => {
    if (interactionScheduler.isRunning()) return;
    if (runState.status !== 'running' && runState.status !== 'paused') return;
    queueMicrotask(() => {
      promptSubmission.drainScheduledInteractions();
    });
  }, [promptSubmission.drainScheduledInteractions, interactionScheduler, runState.status, runtimeEventsHook.runtimeEvents, review]);

  // ─── Lifecycle effects ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      endInteraction();
      void codara.dispose().catch(() => undefined);
    };
  }, [codara, endInteraction]);

  useEffect(() => {
    if (store.getState().initialCoreStateLoaded) return;
    store.patch({initialCoreStateLoaded: true});
    void messageSync.refreshCoreState().catch((error) => {
      reportError(error);
    });
  }, [messageSync.refreshCoreState, reportError, store]);

  // ─── Composer, UI toggle, and submit actions ────────────────────────
  // All created once (empty deps). Composer and toggle actions are pure
  // delegations to stable React setters; submit reads mutable state via
  // refs/closures that are always current.
  const actions = useMemo(() => {
    const applyComposerChange = (updater: (current: CliComposerState) => CliComposerState) => {
      setComposer((current) => updater(current));
      setComposerActivityVersion((current) => current + 1);
    };

    return {
      // Composer
      insertText: (input: string) => applyComposerChange((c) => insertComposerText(c, input)),
      replaceText: (text: string) => applyComposerChange(() => replaceComposerText(text)),
      insertNewline: () => applyComposerChange((c) => insertComposerNewline(c)),
      backspace: () => applyComposerChange((c) => backspaceComposerText(c)),
      moveCursorLeft: () => applyComposerChange((c) => moveComposerCursorLeft(c)),
      moveCursorRight: () => applyComposerChange((c) => moveComposerCursorRight(c)),
      moveCursorUp: () => applyComposerChange((c) => moveComposerCursorUp(c)),
      moveCursorDown: () => applyComposerChange((c) => moveComposerCursorDown(c)),
      moveCursorHome: () => applyComposerChange((c) => moveComposerCursorHome(c)),
      moveCursorEnd: () => applyComposerChange((c) => moveComposerCursorEnd(c)),
      // UI toggles
      toggleSubagentRunsPanel: () => setSubagentRunPanelVisible((c) => toggleSubagentRunsPanelAction(c)),
      toggleExpand: () => setExpandedAll((c) => toggleExpandAction(c)),
      dismissCommandOutput: () => setCommandOutput(dismissCommandOutputAction()),
      scrollCommandOutput: (delta: number) => setCommandOutput((c) => scrollCommandOutputAction(c, delta)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable React setters
  }, []);

  // Submit callbacks reference mutable promptSubmission via closure.
  // Wrapped in useCallback so they update when promptSubmission changes.
  const submitDraft = useCallback(() => {
    const prompt = composer.text.trim();
    if (!prompt) return;
    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void promptSubmission.submitPrompt(prompt);
  }, [composer.text, promptSubmission]);

  const submitText = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void promptSubmission.submitPrompt(prompt);
  }, [promptSubmission]);

  // ─── Derived state ─────────────────────────────────────────────────
  const hasConversation = useMemo(
    () => hasTranscriptContent({
      coreMessages: messageSync.coreMessages,
      notices,
      activeTurn,
      runtimeEvents: runtimeEventsHook.runtimeEvents,
      initialNoticeCount,
    }),
    [activeTurn, messageSync.coreMessages, initialNoticeCount, notices, runtimeEventsHook.runtimeEvents],
  );

  // ─── Return composed controller ────────────────────────────────────
  return useMemo(() => ({
    composer,
    composerActivityVersion,
    notices,
    commandOutput,
    dismissCommandOutput: actions.dismissCommandOutput,
    scrollCommandOutput: actions.scrollCommandOutput,
    activeTurn,
    review,
    coreMessages: messageSync.coreMessages,
    runtimeEvents: runtimeEventsHook.runtimeEvents,
    latestRuntimeEvent: runtimeEventsHook.latestRuntimeEvent,
    hasConversation,
    runState,
    interactionState,
    sessionState: messageSync.sessionState,
    insertText: actions.insertText,
    replaceText: actions.replaceText,
    insertNewline: actions.insertNewline,
    backspace: actions.backspace,
    moveCursorLeft: actions.moveCursorLeft,
    moveCursorRight: actions.moveCursorRight,
    moveCursorUp: actions.moveCursorUp,
    moveCursorDown: actions.moveCursorDown,
    moveCursorHome: actions.moveCursorHome,
    moveCursorEnd: actions.moveCursorEnd,
    submitDraft,
    submitText,
    focusReviewWindow: reviewMachine.focusReviewWindow,
    focusPromptWindow: reviewMachine.focusPromptWindow,
    subagentRunPanelVisible,
    toggleSubagentRunsPanel: actions.toggleSubagentRunsPanel,
    expandedAll,
    toggleExpand: actions.toggleExpand,
    moveReviewLeft: reviewMachine.moveReviewLeft,
    moveReviewRight: reviewMachine.moveReviewRight,
    selectPreviousReviewAction: reviewMachine.selectPreviousReviewAction,
    selectNextReviewAction: reviewMachine.selectNextReviewAction,
    selectPreviousReview: reviewMachine.selectPreviousReview,
    selectNextReview: reviewMachine.selectNextReview,
    toggleReviewFocus: reviewMachine.toggleReviewFocus,
    activateReviewSelection: reviewMachine.activateReviewSelection,
    insertReviewText: reviewMachine.insertReviewText,
    insertReviewNewline: reviewMachine.insertReviewNewline,
    backspaceReviewInput: reviewMachine.backspaceReviewInput,
    submitReviewAction: reviewMachine.submitReviewAction,
    quickReviewAction: reviewMachine.quickReviewAction,
    permissionBack: reviewMachine.permissionBack,
    permissionConfirm: reviewMachine.permissionConfirm,
    permissionRejectSend: reviewMachine.permissionRejectSend,
    permissionRejectSilent: reviewMachine.permissionRejectSilent,
  }), [
    actions,
    activeTurn,
    commandOutput,
    composer,
    composerActivityVersion,
    expandedAll,
    hasConversation,
    interactionState,
    messageSync,
    notices,
    review,
    reviewMachine,
    runState,
    runtimeEventsHook,
    submitDraft,
    submitText,
    subagentRunPanelVisible,
  ]);
}

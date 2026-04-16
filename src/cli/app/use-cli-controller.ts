import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, ReviewRequest, SessionState} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {
  createComposerState,
} from '../composer/state';
import type {CliComposerState} from '../composer/state';
import {hasTranscriptContent} from '../transcript/model';
import {
  composerInsertText,
  composerReplaceText,
  composerInsertNewline,
  composerBackspace,
  composerMoveCursorLeft,
  composerMoveCursorRight,
  composerMoveCursorUp,
  composerMoveCursorDown,
  composerMoveCursorHome,
  composerMoveCursorEnd,
} from './cli-composer-actions';
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
import type {CliEvent} from '../store/actions';
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

  // ─── Local UI state ────────────────────────────────────────────────
  const [composer, setComposer] = useState(() => createComposerState());
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [notices, setNotices] = useState<CliNotice[]>(initialNotices);
  const [activeTurn, setActiveTurnState] = useState<CliActiveTurn | undefined>();
  const [review, setReview] = useState<CliReviewState | undefined>();
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [runningAgentCount, setRunningAgentCount] = useState(0);
  const [interactionState, setInteractionState] = useState<CliInteractionState>({
    focusedSurface: 'prompt',
    pendingCount: 0,
    promptBlocked: false,
  });
  const [subagentRunPanelVisible, setSubagentRunPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const [commandOutput, setCommandOutput] = useState<{content: string; commandName?: string; scrollOffset: number} | undefined>();

  // ─── Shared mutable refs ───────────────────────────────────────────
  const interactionScheduler = useMemo(() => new CliInteractionScheduler(), []);
  const reviewRef = useRef<CliReviewState | undefined>(undefined);
  const activeTurnRef = useRef<CliActiveTurn | undefined>(undefined);
  const coreMessagesRef = useRef<readonly BaseMessage[]>([]);
  const runStateRef = useRef<CliRunState>({status: 'idle'});
  const promptStartMessageCountRef = useRef(0);
  const pendingBackgroundNoticesRef = useRef<CliNotice[]>([]);
  const settlingFinalReplyRef = useRef(false);
  const initialCoreStateLoadedRef = useRef(false);

  // dispatchEvent is a no-op — the store was write-only (never read by any component).
  // The CliEvent type is retained so that hooks can still accept the callback signature.
  const dispatchEvent = useCallback((_event: CliEvent) => {}, []);

  // ─── Ref sync effects ─────────────────────────────────────────────
  useEffect(() => { reviewRef.current = review; }, [review]);
  useEffect(() => { activeTurnRef.current = activeTurn; }, [activeTurn]);
  useEffect(() => { runStateRef.current = runState; }, [runState]);

  // ─── Wrapped state setters (keep refs in sync) ────────────────────
  const setReviewState = useCallback((
    input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined),
  ) => {
    const next = typeof input === 'function'
      ? (input as (current: CliReviewState | undefined) => CliReviewState | undefined)(reviewRef.current)
      : input;
    reviewRef.current = next;
    setReview(next);
  }, []);

  const setActiveTurn = useCallback((
    input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined),
  ) => {
    const next = typeof input === 'function'
      ? (input as (current: CliActiveTurn | undefined) => CliActiveTurn | undefined)(activeTurnRef.current)
      : input;
    activeTurnRef.current = next;
    setActiveTurnState(next);
  }, []);

  const appendNotice = useCallback((level: CliNotice['level'], content: string) => {
    const message = content.trim();
    if (!message) return;
    setNotices((current) => [
      ...current,
      {id: `${level}-${randomUUID()}`, level, content: message},
    ]);
  }, []);

  // ─── Interaction scheduling primitives ─────────────────────────────
  const syncInteractionState = useCallback(() => {
    setInteractionState((current) =>
      resolveInteractionStateSnapshot(current, interactionScheduler, reviewRef.current),
    );
  }, [interactionScheduler]);

  const beginInteraction = useCallback((kind: CliInteractionKind) => {
    interactionScheduler.begin(kind);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const endInteraction = useCallback(() => {
    interactionScheduler.end();
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const enqueueSessionPrompt = useCallback((prompt: string) => {
    interactionScheduler.enqueueSessionPrompt(prompt);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const enqueueReviewResponse = useCallback((interaction: Omit<QueuedReviewResponseInteraction, 'kind'>) => {
    interactionScheduler.enqueueReviewResponse(interaction);
    syncInteractionState();
  }, [interactionScheduler, syncInteractionState]);

  const flushPendingBackgroundNotices = useCallback(() => {
    if (pendingBackgroundNoticesRef.current.length === 0) return;
    const queued = pendingBackgroundNoticesRef.current;
    pendingBackgroundNoticesRef.current = [];
    setNotices((current) => appendUniqueNotices(current, queued));
  }, []);

  const reportError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setRunState({status: 'error', error: message});
    dispatchEvent({type: 'AGENT_ERROR', error: message});
    setActiveTurn(undefined);
    appendNotice('error', message);
    return message;
  }, [appendNotice, dispatchEvent, setActiveTurn]);

  // ─── Settlement logic ──────────────────────────────────────────────
  const settleRunningPromptTurnIfReady = useCallback((messages?: readonly BaseMessage[]): boolean => {
    if (runStateRef.current.status !== 'running') return false;
    if (runStateRef.current.phase === 'subagent_completion') return false;

    const hasVisibleReplyInMessagesNow = hasVisibleAssistantReplyInMessages(
      messages ?? coreMessagesRef.current,
      promptStartMessageCountRef.current,
      codara.getSubagentRunSummaries(),
    );
    const hasVisibleReplyInActiveTurn = hasVisibleAssistantReply(
      activeTurnRef.current,
      codara.getSubagentRunSummaries(),
    );
    if (!hasVisibleReplyInMessagesNow && !hasVisibleReplyInActiveTurn) return false;

    settlingFinalReplyRef.current = true;
    setRunState({status: 'done'});
    if (hasVisibleReplyInMessagesNow) {
      setActiveTurn(undefined);
    }
    return true;
  }, [codara, setActiveTurn]);

  // ─── Ref bridges for circular deps between hooks ───────────────────
  const refreshCoreStateRef = useRef<() => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>>(
    async () => ({status: 'idle', messages: []}),
  );
  const drainScheduledInteractionsRef = useRef<() => void>(() => undefined);

  // Stable function wrappers that delegate to the latest ref value.
  // These never change identity, so downstream useCallback deps stay stable.
  const refreshCoreStateBridge = useCallback(
    () => refreshCoreStateRef.current(),
    [],
  );
  const drainScheduledInteractionsBridge = useCallback(
    () => drainScheduledInteractionsRef.current(),
    [],
  );

  // ─── Compose: useReviewMachine ─────────────────────────────────────
  const reviewMachine = useReviewMachine({
    codara,
    interactionScheduler,
    reviewAutoActions,
    reviewRef,
    runStateRef,
    pendingBackgroundNoticesRef,
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
    reviewRef,
    activeTurnRef,
    coreMessagesRef,
    runStateRef,
    promptStartMessageCountRef,
    setReviewState,
    setActiveTurn,
    syncInteractionState,
    settleRunningPromptTurnIfReady,
    suppressSettlingDismissedReview: reviewMachine.suppressSettlingDismissedReview,
  });

  // Wire the ref bridge for refreshCoreState
  refreshCoreStateRef.current = messageSync.refreshCoreState;

  // ─── Compose: usePromptSubmission ──────────────────────────────────
  const [runtimeEventsForDrain, setRuntimeEventsForDrain] = useState<readonly CodaraRuntimeEvent[]>([]);
  const promptSubmission = usePromptSubmission({
    codara,
    interactionScheduler,
    initialPrompt,
    reviewRef,
    activeTurnRef,
    coreMessagesRef,
    runStateRef,
    promptStartMessageCountRef,
    pendingBackgroundNoticesRef,
    settlingFinalReplyRef,
    setActiveTurn,
    setRunState,
    setCommandOutput,
    setRuntimeEvents: setRuntimeEventsForDrain,
    sessionState: messageSync.sessionState,
    beginInteraction,
    endInteraction,
    enqueueSessionPrompt,
    syncInteractionState,
    refreshCoreState: messageSync.refreshCoreState,
    appendNotice,
    reportError,
    flushPendingBackgroundNotices,
    dispatchEvent,
    reopenSession,
    openFile,
    onShowSessionPicker,
    runQueuedReviewResponse: reviewMachine.runQueuedReviewResponse,
  });

  // Wire the ref bridge for drainScheduledInteractions
  drainScheduledInteractionsRef.current = promptSubmission.drainScheduledInteractions;

  // ─── Compose: useRuntimeEvents ─────────────────────────────────────
  const runtimeEventsHook = useRuntimeEvents({
    codara,
    interactionScheduler,
    setActiveTurn,
    setNotices,
    setRunningAgentCount,
    setRunState,
    pendingBackgroundNoticesRef,
    dispatchEvent,
    endInteraction,
    refreshAuxiliaryState: messageSync.refreshAuxiliaryState,
    refreshCoreState: messageSync.refreshCoreState,
    refreshCoreStateUntilPromptSettles: messageSync.refreshCoreStateUntilPromptSettles,
    settleRunningPromptTurnIfReady,
    drainScheduledInteractions: promptSubmission.drainScheduledInteractions,
  });

  // ─── Agent count / run state effects ───────────────────────────────
  useEffect(() => {
    if (review) return;
    if (runningAgentCount > 0) {
      if (runState.status !== 'running' && !settlingFinalReplyRef.current) {
        setRunState({status: 'running', phase: 'prompt_stream'});
      }
    } else if (runState.status === 'running' && !interactionScheduler.isRunning() && runState.phase !== 'subagent_wait') {
      settlingFinalReplyRef.current = false;
      setRunState({status: 'done'});
    }
  }, [runningAgentCount, runState.status, runState.phase, review, interactionScheduler]);

  useEffect(() => {
    settleRunningPromptTurnIfReady(messageSync.coreMessages);
  }, [messageSync.coreMessages, settleRunningPromptTurnIfReady]);

  useEffect(() => {
    if (runState.status !== 'done') return;
    if (!activeTurnOwnsVisibleTranscript(activeTurn, codara.getSubagentRunSummaries())) return;
    if (!hasVisibleAssistantReplyInMessages(messageSync.coreMessages, promptStartMessageCountRef.current, codara.getSubagentRunSummaries())) return;
    setActiveTurn(undefined);
  }, [activeTurn, codara, messageSync.coreMessages, runState.status, setActiveTurn]);

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
    if (initialCoreStateLoadedRef.current) return;
    initialCoreStateLoadedRef.current = true;
    void messageSync.refreshCoreState().catch((error) => {
      reportError(error);
    });
  }, [messageSync.refreshCoreState, reportError]);

  // ─── Composer actions ──────────────────────────────────────────────
  const applyComposerChange = useCallback((updater: (current: CliComposerState) => CliComposerState) => {
    setComposer((current) => updater(current));
    setComposerActivityVersion((current) => current + 1);
  }, []);

  const insertText = useCallback((input: string) => {
    applyComposerChange((current) => composerInsertText(current, input));
  }, [applyComposerChange]);

  const replaceText = useCallback((text: string) => {
    applyComposerChange(() => composerReplaceText(text));
  }, [applyComposerChange]);

  const insertNewline = useCallback(() => {
    applyComposerChange((current) => composerInsertNewline(current));
  }, [applyComposerChange]);

  const backspace = useCallback(() => {
    applyComposerChange((current) => composerBackspace(current));
  }, [applyComposerChange]);

  const moveCursorLeft = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorLeft(current));
  }, [applyComposerChange]);

  const moveCursorRight = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorRight(current));
  }, [applyComposerChange]);

  const moveCursorUp = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorUp(current));
  }, [applyComposerChange]);

  const moveCursorDown = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorDown(current));
  }, [applyComposerChange]);

  const moveCursorHome = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorHome(current));
  }, [applyComposerChange]);

  const moveCursorEnd = useCallback(() => {
    applyComposerChange((current) => composerMoveCursorEnd(current));
  }, [applyComposerChange]);

  // ─── Simple UI toggles ─────────────────────────────────────────────
  const toggleSubagentRunsPanel = useCallback(() => {
    setSubagentRunPanelVisible((current) => toggleSubagentRunsPanelAction(current));
  }, []);

  const toggleExpand = useCallback(() => {
    setExpandedAll((current) => toggleExpandAction(current));
  }, []);

  const dismissCommandOutput = useCallback(() => {
    setCommandOutput(dismissCommandOutputAction());
  }, []);

  const scrollCommandOutput = useCallback((delta: number) => {
    setCommandOutput((current) => scrollCommandOutputAction(current, delta));
  }, []);

  // ─── Draft submission ──────────────────────────────────────────────
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
    dismissCommandOutput,
    scrollCommandOutput,
    activeTurn,
    review,
    coreMessages: messageSync.coreMessages,
    runtimeEvents: runtimeEventsHook.runtimeEvents,
    latestRuntimeEvent: runtimeEventsHook.latestRuntimeEvent,
    hasConversation,
    runState,
    interactionState,
    sessionState: messageSync.sessionState,
    insertText,
    replaceText,
    insertNewline,
    backspace,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    moveCursorDown,
    moveCursorHome,
    moveCursorEnd,
    submitDraft,
    submitText,
    focusReviewWindow: reviewMachine.focusReviewWindow,
    focusPromptWindow: reviewMachine.focusPromptWindow,
    subagentRunPanelVisible,
    toggleSubagentRunsPanel,
    expandedAll,
    toggleExpand,
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
    activeTurn,
    backspace,
    commandOutput,
    composer,
    composerActivityVersion,
    dismissCommandOutput,
    expandedAll,
    hasConversation,
    interactionState,
    review,
    insertNewline,
    insertText,
    messageSync,
    moveCursorDown,
    moveCursorEnd,
    moveCursorHome,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    notices,
    replaceText,
    reviewMachine,
    runState,
    runtimeEventsHook,
    scrollCommandOutput,
    submitDraft,
    submitText,
    subagentRunPanelVisible,
    toggleExpand,
    toggleSubagentRunsPanel,
  ]);
}

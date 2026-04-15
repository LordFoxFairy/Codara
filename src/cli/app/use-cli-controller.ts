import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {ReviewRequest} from '@core/agent';
import {isSubagentInternalAssistantText} from '@capability/subagent/completion';
import {
  createComposerState,
} from '../composer/state';
import type {CliComposerState} from '../composer/types';
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
  focusReviewWindowAction,
  focusPromptWindowAction,
  selectPreviousReviewActionUpdate,
  selectNextReviewActionUpdate,
  moveReviewLeftUpdate,
  moveReviewRightUpdate,
  toggleReviewFocusUpdate,
  activateReviewSelectionUpdate,
  insertReviewTextUpdate,
  insertReviewNewlineUpdate,
  backspaceReviewInputUpdate,
} from './cli-review-actions';
import {
  activateCliReviewFocusedSelection,
  advanceCliReviewToNextStep,
  isPermissionReviewState,
  prepareCliReviewSubmission,
  resolveCliReviewFocusedFooterAction,
  setPermissionStage,
  type CliReviewAutoAction,
} from './review-state';
import {
  appendInteractionText,
  applyInteractionChunkToTurn,
  containsAgentLaunchChatter,
  finalizeBufferedInteractionText,
} from './interaction-turn';
import {
  CliInteractionScheduler,
  type QueuedReviewResponseInteraction,
} from './interaction-scheduler';
import {readCliReviewProjection, syncProjectedReview} from './runtime-projection';
import {computeRuntimeEventEffects} from './cli-event-router';
import {resolveInteractionStateSnapshot, takeNextScheduledInteraction} from './cli-interaction-queue';
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
  deriveRunStateFromAgentState,
  hasTrackedForegroundSubagentRuns,
  shouldKeepPromptTurnRunningAfterAgentLaunch,
  hasVisibleAssistantReply,
  activeTurnOwnsVisibleTranscript,
  hasVisibleMainAssistantText,
  hasVisibleAssistantReplyInMessages,
  shouldContinuePollingForPromptSettlement,
  resolveHydratedCoreMessages,
  appendRuntimeEventPreservingOpenStarts,
  shouldHandoffForegroundTurnToReview,
  suppressActiveTurnForReview,
  waitForForegroundReviewResumeReady,
  REVIEW_AUTO_ACTION_DELAY_MS,
  REVIEW_QUEUE_HANDOFF_TIMEOUT_MS,
  REVIEW_QUEUE_HANDOFF_POLL_MS,
  PROMPT_SETTLE_REFRESH_TIMEOUT_MS,
  PROMPT_SETTLE_REFRESH_POLL_MS,
} from './cli-controller-logic';

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
  const [composer, setComposer] = useState(() => createComposerState());
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [notices, setNotices] = useState<CliNotice[]>(initialNotices);
  const [activeTurn, setActiveTurnState] = useState<CliActiveTurn | undefined>();
  const [review, setReview] = useState<CliReviewState | undefined>();
  const [coreMessages, setCoreMessagesState] = useState<readonly BaseMessage[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<readonly CodaraRuntimeEvent[]>([]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [runningAgentCount, setRunningAgentCount] = useState(0);
  const [interactionState, setInteractionState] = useState<CliInteractionState>({
    focusedSurface: 'prompt',
    pendingCount: 0,
    promptBlocked: false,
  });
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());
  const [subagentRunPanelVisible, setSubagentRunPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const [commandOutput, setCommandOutput] = useState<{content: string; commandName?: string; scrollOffset: number} | undefined>();
  const interactionScheduler = useMemo(() => new CliInteractionScheduler(), []);
  const initialPromptSentRef = useRef(false);
  const initialCoreStateLoadedRef = useRef(false);
  const reviewRef = useRef<CliReviewState | undefined>(undefined);
  const activeTurnRef = useRef<CliActiveTurn | undefined>(undefined);
  const coreMessagesRef = useRef<readonly BaseMessage[]>([]);
  const runStateRef = useRef<CliRunState>({status: 'idle'});
  const promptStartMessageCountRef = useRef(0);
  const autoActionsRef = useRef([...reviewAutoActions]);
  const handledAutoReviewIdsRef = useRef<Set<string>>(new Set());
  const pendingBackgroundNoticesRef = useRef<CliNotice[]>([]);
  const settlingDismissedReviewIdRef = useRef<string | undefined>(undefined);
  const runQueuedSessionPromptRef = useRef<(prompt: string) => Promise<void>>(async () => undefined);
  const settlingFinalReplyRef = useRef(false);

  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  const setCoreMessages = useCallback((messages: readonly BaseMessage[]) => {
    coreMessagesRef.current = messages;
    setCoreMessagesState(messages);
  }, []);

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
    if (!message) {
      return;
    }

    setNotices((current) => [
      ...current,
      {
        id: `${level}-${randomUUID()}`,
        level,
        content: message,
      },
    ]);
  }, []);

  const syncInteractionState = useCallback(() => {
    setInteractionState((current) =>
      resolveInteractionStateSnapshot(current, interactionScheduler, reviewRef.current),
    );
  }, [interactionScheduler]);

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
    if (pendingBackgroundNoticesRef.current.length === 0) {
      return;
    }
    const queued = pendingBackgroundNoticesRef.current;
    pendingBackgroundNoticesRef.current = [];
    setNotices((current) => appendUniqueNotices(current, queued));
  }, []);

  const reportError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setRunState({status: 'error', error: message});
    setActiveTurn(undefined);
    appendNotice('error', message);
    return message;
  }, [appendNotice, setActiveTurn]);

  const settleRunningPromptTurnIfReady = useCallback((messages?: readonly BaseMessage[]): boolean => {
    if (runStateRef.current.status !== 'running') {
      return false;
    }

    // The subagent completion phase owns its own settlement via the active stream.
    // Settling here would fire on stale preamble text and mark done prematurely.
    // subagent_wait is NOT excluded — the polling loop should still be able to
    // settle when a visible reply arrives from refreshCoreState.
    if (runStateRef.current.phase === 'subagent_completion') {
      return false;
    }

    const hasVisibleReplyInMessagesNow = hasVisibleAssistantReplyInMessages(
      messages ?? coreMessagesRef.current,
      promptStartMessageCountRef.current,
      codara.getSubagentRunSummaries(),
    );
    const hasVisibleReplyInActiveTurn = hasVisibleAssistantReply(
      activeTurnRef.current,
      codara.getSubagentRunSummaries(),
    );
    if (!hasVisibleReplyInMessagesNow && !hasVisibleReplyInActiveTurn) {
      return false;
    }

    settlingFinalReplyRef.current = true;
    setRunState({status: 'done'});
    if (hasVisibleReplyInMessagesNow) {
      setActiveTurn(undefined);
    }
    return true;
  }, [codara, setActiveTurn]);

  const refreshAuxiliaryState = useCallback(() => {
    const projection = readCliReviewProjection(codara);
    const nextReview = suppressSettlingDismissedReview(syncProjectedReview(codara, reviewRef.current, {
      pendingReview: projection.activeReviewRequest,
    }), projection.activeReviewRequest);
    setSessionState(codara.getState());
    setReviewState(nextReview);
    setActiveTurn((current) => suppressActiveTurnForReview(current, nextReview));
    syncInteractionState();
  }, [codara, setActiveTurn, setReviewState, suppressSettlingDismissedReview, syncInteractionState]);

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
  }, [codara, setActiveTurn, setCoreMessages, setReviewState, settleRunningPromptTurnIfReady, suppressSettlingDismissedReview, syncInteractionState]);

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

      // Yield to React render loop so state effects can fire.
      await new Promise((resolve) => setTimeout(resolve, PROMPT_SETTLE_REFRESH_POLL_MS));

      // Exit if the interaction ended while we were waiting — the runningAgentCount
      // effect handles the done transition instead.
      if (!interactionScheduler.isRunning()) {
        return false;
      }
    }

    return false;
  }, [codara, interactionScheduler, refreshCoreState, settleRunningPromptTurnIfReady]);

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
      const nextAgentState = await refreshCoreState();
      setRunState(nextAgentState.pendingReview || nextAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
    }
    return true;
  }, [beginInteraction, codara, endInteraction, interactionScheduler, refreshCoreState, reportError, setActiveTurn, syncInteractionState]);

  const drainScheduledInteractions = useCallback(() => {
    const result = takeNextScheduledInteraction(interactionScheduler);

    if (result.kind === 'busy') {
      return;
    }

    if (result.kind === 'session_prompt' || result.kind === 'review_response') {
      syncInteractionState();
      void (async () => {
        let handled = true;
        if (result.kind === 'session_prompt') {
          await runQueuedSessionPromptRef.current(result.prompt);
        } else {
          handled = await runQueuedReviewResponse(result.interaction);
        }
        flushPendingBackgroundNotices();
        if (handled) {
          drainScheduledInteractions();
        }
      })();
      return;
    }

    // result.kind === 'empty'
    syncInteractionState();

    // When draining finds nothing and the interaction is done, settle the prompt
    // if possible. This handles cases where runningAgentCount never changed (e.g.,
    // detached agent end events with no matching start).
    if (runStateRef.current.status === 'running' && runStateRef.current.phase !== 'subagent_wait') {
      settlingFinalReplyRef.current = false;
      setRunState({status: 'done'});
    }
  }, [flushPendingBackgroundNotices, interactionScheduler, runQueuedReviewResponse, syncInteractionState]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
      const effects = computeRuntimeEventEffects({
        event,
        currentRuntimeEvents: [],  // appendRuntimeEventPreservingOpenStarts uses the setter's prev value
        interactionRunning: interactionScheduler.isRunning(),
      });

      // Apply agent count delta
      if (effects.agentCountDelta !== 0) {
        const delta = effects.agentCountDelta;
        setRunningAgentCount((count) => Math.max(0, count + delta));
      }

      // Update runtime events via setter to get latest state
      setRuntimeEvents((current) => appendRuntimeEventPreservingOpenStarts(current, event));

      // Seal active turn if needed
      if (effects.sealedActiveTurn) {
        setActiveTurn(effects.sealedActiveTurn);
      }

      // Apply notices
      if (effects.immediateNotices.length > 0) {
        setNotices((current) => appendUniqueNotices(current, effects.immediateNotices));
      }
      if (effects.queuedNotices.length > 0) {
        pendingBackgroundNoticesRef.current = appendUniqueNotices(
          pendingBackgroundNoticesRef.current,
          effects.queuedNotices,
        );
      }

      // Handle foreground subagent review interrupt
      if (effects.foregroundSubagentReview) {
        endInteraction();
        setRunState({status: 'paused'});
        refreshAuxiliaryState();
        return;
      }

      // Apply refresh strategy
      if (effects.refreshStrategy.kind === 'core_then_settle') {
        const agentPhase = effects.refreshStrategy.agentPhase;
        void refreshCoreState()
          .then((nextAgentState) => {
            const settled = settleRunningPromptTurnIfReady(nextAgentState.messages);
            if (!settled && agentPhase === 'end') {
              void refreshCoreStateUntilPromptSettles();
            }
            return nextAgentState;
          })
          .catch(() => {
            refreshAuxiliaryState();
          });
      } else if (effects.refreshStrategy.kind === 'auxiliary_only') {
        refreshAuxiliaryState();
      }

      // Drain interactions on agent events
      if (effects.shouldDrainInteractions) {
        queueMicrotask(() => {
          drainScheduledInteractions();
        });
      }
    });
  }, [codara, drainScheduledInteractions, endInteraction, interactionScheduler, refreshAuxiliaryState, refreshCoreState, refreshCoreStateUntilPromptSettles, setActiveTurn, settleRunningPromptTurnIfReady]);

  // Update runState based on runningAgentCount
  useEffect(() => {
    if (review) {
      return;
    }

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
    settleRunningPromptTurnIfReady(coreMessages);
  }, [coreMessages, settleRunningPromptTurnIfReady]);

  useEffect(() => {
    if (runState.status !== 'done') {
      return;
    }

    if (!activeTurnOwnsVisibleTranscript(activeTurn, codara.getSubagentRunSummaries())) {
      return;
    }

    if (!hasVisibleAssistantReplyInMessages(coreMessages, promptStartMessageCountRef.current, codara.getSubagentRunSummaries())) {
      return;
    }

    setActiveTurn(undefined);
  }, [activeTurn, codara, coreMessages, runState.status, setActiveTurn]);

  useEffect(() => {
    if (interactionScheduler.isRunning()) {
      return;
    }

    if (runState.status !== 'running' && runState.status !== 'paused') {
      return;
    }

    queueMicrotask(() => {
      drainScheduledInteractions();
    });
  }, [drainScheduledInteractions, interactionScheduler, runState.status, runtimeEvents, review]);

  const runSlashCommand = useCallback(async (prompt: string) => {
    const result = await codara.executeCommand(prompt);

    if (result.action?.type === 'show_session_picker') {
      if (onShowSessionPicker) {
        onShowSessionPicker();
      } else {
        appendNotice('error', 'Session picker is not available in this CLI runtime.');
      }
      setRunState({status: 'done'});
      return;
    }

    if (result.action?.type === 'resume_session') {
      appendNotice(result.ok ? 'system' : 'error', result.output || '(no output)');
      if (!result.ok) {
        setRunState({status: 'error', error: result.output});
        return;
      }
      if (sessionState.sessionId === result.action.sessionId) {
        setRunState({status: 'done'});
        return;
      }
      if (!reopenSession) {
        setRunState({status: 'error', error: 'Session resume handler is not available in this CLI runtime.'});
        appendNotice('error', 'Session resume handler is not available in this CLI runtime.');
        return;
      }
      await reopenSession(result.action.sessionId);
      return;
    }

    if (result.action?.type === 'open_file') {
      const opened = openFile ? await openFile(result.action.path) : false;
      appendNotice(opened ? 'system' : 'warning', opened
        ? `Opened ${result.action.path}`
        : `Open file: ${result.action.path}`);
      setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
      return;
    }

    if (result.ok) {
      setCommandOutput({content: result.output || '(no output)', commandName: result.command, scrollOffset: 0});
    } else {
      appendNotice('error', result.output || '(no output)');
    }
    const nextAgentState = await refreshCoreState();
    setRunState(result.ok
      ? nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'}
      : {status: 'error', error: result.output});
  }, [appendNotice, codara, onShowSessionPicker, openFile, refreshCoreState, reopenSession, sessionState.sessionId]);

  const runAgentPrompt = useCallback(async (prompt: string) => {
    const promptStartMessageCount = coreMessagesRef.current.length;
    promptStartMessageCountRef.current = promptStartMessageCount;
    setActiveTurn({
      id: `turn-${randomUUID()}`,
      prompt,
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    });

    let sawText = false;
    let launchedAgent = false;

    for await (const chunk of codara.streamInteraction({
      kind: 'prompt',
      input: prompt,
      config: {streamMode: 'messages'},
    })) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }
      if (Array.isArray(chunk.tool_calls) && chunk.tool_calls.some((toolCall) => toolCall?.name === 'Agent')) {
        launchedAgent = true;
      }
      setActiveTurn((current) => {
        const result = applyInteractionChunkToTurn(current, chunk, {
          captureThinking: true,
          detectAgentLaunch: true,
          shouldSuppressText: (text) => {
            return containsAgentLaunchChatter(text) || isSubagentInternalAssistantText({
              text,
              runs: codara.getSubagentRunSummaries(),
            });
          },
        });
        if (result.sawText) {
          sawText = true;
        }
        return result.turn;
      });
    }

    setActiveTurn((current) => {
      const finalized = finalizeBufferedInteractionText(current);
      if (
        finalized?.responseBeforeRuntime?.trim()
        || finalized?.response.trim()
        || finalized?.pendingResponse?.trim()
      ) {
        sawText = true;
      }
      return finalized;
    });

    sawText = sawText
      || hasVisibleAssistantReply(activeTurnRef.current, codara.getSubagentRunSummaries())
      || hasVisibleAssistantReplyInMessages(coreMessagesRef.current, promptStartMessageCount, codara.getSubagentRunSummaries());
    const nextAgentState = await refreshCoreState();
    sawText = sawText
      || hasVisibleAssistantReplyInMessages(coreMessagesRef.current, promptStartMessageCount, codara.getSubagentRunSummaries())
      || hasVisibleAssistantReplyInMessages(nextAgentState.messages, promptStartMessageCount, codara.getSubagentRunSummaries());

    if (nextAgentState.status === 'paused') {
      setRunState({status: 'paused'});
      return;
    }

    // If agents are still running, keep the turn active
    if (shouldKeepPromptTurnRunningAfterAgentLaunch({
      nextAgentState,
      codara,
      launchedAgent,
      sawVisibleReply: sawText,
    })) {
      setRunState({status: 'running', phase: 'subagent_wait'});
      return;
    }

    if (!sawText) {
      setActiveTurn((current) => current ? {...current, response: '(no output)'} : current);
    }

    setActiveTurn(undefined);
  }, [codara, refreshCoreState, setActiveTurn]);

  const runQueuedSessionPrompt = useCallback(async (prompt: string): Promise<void> => {
    beginInteraction('session_prompt');
    settlingFinalReplyRef.current = false;
    setRunState({status: 'running', phase: 'prompt_stream'});
    setRuntimeEvents([]);
    setCommandOutput(undefined);

    try {
      if (prompt.startsWith('/')) {
        await runSlashCommand(prompt);
        return;
      }

      await runAgentPrompt(prompt);
    } catch (error) {
      setActiveTurn(undefined);
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
    }
  }, [beginInteraction, endInteraction, refreshCoreState, reportError, runAgentPrompt, runSlashCommand, setActiveTurn]);
  runQueuedSessionPromptRef.current = runQueuedSessionPrompt;

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return;
    }

    if (interactionScheduler.isRunning()) {
      enqueueSessionPrompt(prompt);
      return;
    }

    await runQueuedSessionPrompt(prompt);
    flushPendingBackgroundNotices();
    drainScheduledInteractions();
  }, [drainScheduledInteractions, enqueueSessionPrompt, flushPendingBackgroundNotices, interactionScheduler, runQueuedSessionPrompt]);

  useEffect(() => {
    return () => {
      endInteraction();
      void codara.dispose().catch(() => undefined);
    };
  }, [codara, endInteraction]);

  useEffect(() => {
    if (initialCoreStateLoadedRef.current) {
      return;
    }
    initialCoreStateLoadedRef.current = true;
    void refreshCoreState().catch((error) => {
      reportError(error);
    });
  }, [refreshCoreState, reportError]);

  useEffect(() => {
    if (!initialPrompt || initialPromptSentRef.current) {
      return;
    }

    initialPromptSentRef.current = true;
    void submitPrompt(initialPrompt);
  }, [initialPrompt, submitPrompt]);

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

  const submitDraft = useCallback(() => {
    const prompt = composer.text.trim();
    if (!prompt) {
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void submitPrompt(prompt);
  }, [composer.text, submitPrompt]);

  const submitText = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void submitPrompt(prompt);
  }, [submitPrompt]);

  const focusReviewWindow = useCallback(() => {
    setInteractionState((current) => focusReviewWindowAction(current, !!reviewRef.current));
  }, []);

  const focusPromptWindow = useCallback(() => {
    setInteractionState((current) => focusPromptWindowAction(current, !!reviewRef.current));
  }, []);

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

    const currentReviewId = reviewRef.current?.request.id;
    const currentIndex = reviews.findIndex((review) => review.reviewId === currentReviewId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + direction + reviews.length) % reviews.length;
    const nextReview = reviews[nextIndex];
    if (!nextReview) {
      return;
    }

    await codara.focusReview(nextReview.reviewId);
    await refreshCoreState();
  }, [codara, refreshCoreState]);

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
    const result = activateReviewSelectionUpdate(reviewRef.current);
    setReviewState(result.review);
    setRunState({status: 'paused'});
  }, [setReviewState]);

  const insertReviewText = useCallback((input: string) => {
    setReviewState((current) => insertReviewTextUpdate(current, input));
  }, [setReviewState]);

  const insertReviewNewline = useCallback(() => {
    setReviewState((current) => insertReviewNewlineUpdate(current));
  }, [setReviewState]);

  const backspaceReviewInput = useCallback(() => {
    setReviewState((current) => backspaceReviewInputUpdate(current));
  }, [setReviewState]);

  const submitReviewAction = useCallback(async (autoAction?: CliReviewAutoAction) => {
    const currentReview = reviewRef.current ?? review;
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

      // Use streaming resume for immediate UI feedback (like Claude Code)
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

        const busyReview = reviewRef.current?.request.id === prepared.review.request.id
          ? {...reviewRef.current, busy: true}
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
                const nextReview = syncProjectedReview(codara, reviewRef.current, {pendingReview: activeReviewRequest});
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
  }, [appendNotice, beginInteraction, codara, drainScheduledInteractions, endInteraction, enqueueReviewResponse, interactionScheduler, refreshCoreState, reportError, review, setActiveTurn, setReviewState, syncInteractionState]);

  const quickReviewAction = useCallback((actionId: string) => {
    // Three-stage permission flow: intercept dont_ask_again and deny
    if (actionId === 'dont_ask_again') {
      setReviewState((current) => current ? setPermissionStage(current, 'always-confirm') : current);
      return;
    }
    if (actionId === 'deny') {
      setReviewState((current) => current ? setPermissionStage(current, 'reject-feedback') : current);
      return;
    }
    void submitReviewAction({action: actionId});
  }, [setReviewState, submitReviewAction]);

  const permissionBack = useCallback(() => {
    setReviewState((current) => current ? setPermissionStage(current, 'prompt') : current);
  }, [setReviewState]);

  const permissionConfirm = useCallback(() => {
    // Claude Code style: confirm adds all patterns to session memory
    void submitReviewAction({action: 'dont_ask_again'});
  }, [submitReviewAction]);

  const permissionRejectSend = useCallback(() => {
    const review = reviewRef.current;
    if (!review) return;
    void submitReviewAction({action: 'deny', comment: review.draft.trim() || undefined});
  }, [submitReviewAction]);

  const permissionRejectSilent = useCallback(() => {
    void submitReviewAction({action: 'deny'});
  }, [submitReviewAction]);

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
      void submitReviewAction(nextAction);
    }, REVIEW_AUTO_ACTION_DELAY_MS);

    return () => clearTimeout(timer);
  }, [review, runState.status, submitReviewAction]);

  const hasConversation = useMemo(
    () => hasTranscriptContent({
      coreMessages,
      notices,
      activeTurn,
      runtimeEvents,
      initialNoticeCount,
    }),
    [activeTurn, coreMessages, initialNoticeCount, notices, runtimeEvents],
  );

  const submitReviewActionCommand = useCallback(() => {
    void submitReviewAction();
  }, [submitReviewAction]);

  return useMemo(() => ({
    composer,
    composerActivityVersion,
    notices,
    commandOutput,
    dismissCommandOutput,
    scrollCommandOutput,
    activeTurn,
    review,
    coreMessages,
    runtimeEvents,
    latestRuntimeEvent: runtimeEvents[runtimeEvents.length - 1],
    hasConversation,
    runState,
    interactionState,
    sessionState,
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
    focusReviewWindow,
    focusPromptWindow,
    subagentRunPanelVisible,
    toggleSubagentRunsPanel,
    expandedAll,
    toggleExpand,
    moveReviewLeft,
    moveReviewRight,
    selectPreviousReviewAction,
    selectNextReviewAction,
    selectPreviousReview,
    selectNextReview,
    toggleReviewFocus,
    activateReviewSelection,
    insertReviewText,
    insertReviewNewline,
    backspaceReviewInput,
    submitReviewAction: submitReviewActionCommand,
    quickReviewAction,
    permissionBack,
    permissionConfirm,
    permissionRejectSend,
    permissionRejectSilent,
  }), [
    activeTurn,
    activateReviewSelection,
    backspace,
    backspaceReviewInput,
    commandOutput,
    composer,
    composerActivityVersion,
    dismissCommandOutput,
    expandedAll,
    focusPromptWindow,
    focusReviewWindow,
    hasConversation,
    interactionState,
    review,
    insertReviewNewline,
    insertReviewText,
    insertNewline,
    insertText,
    moveCursorDown,
    moveCursorEnd,
    moveCursorHome,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    moveReviewLeft,
    moveReviewRight,
    notices,
    permissionBack,
    permissionConfirm,
    permissionRejectSend,
    permissionRejectSilent,
    quickReviewAction,
    replaceText,
    runState,
    runtimeEvents,
    scrollCommandOutput,
    selectNextReview,
    selectNextReviewAction,
    selectPreviousReview,
    selectPreviousReviewAction,
    sessionState,
    submitDraft,
    submitReviewActionCommand,
    submitText,
    subagentRunPanelVisible,
    toggleExpand,
    toggleReviewFocus,
    toggleSubagentRunsPanel,
    coreMessages,
  ]);
}

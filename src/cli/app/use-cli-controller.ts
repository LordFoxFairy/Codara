import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState} from '@/index';
import {AIMessage, AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {ReviewRequest} from '@core/agent';
import type {SubagentRunQuerySummary} from '@codara/types';
import {isSubagentInternalAssistantText} from '@capability/subagent/completion';
import {readVisibleMessageText} from '@shared/messages';
import {
  backspaceComposerText,
  createComposerState,
  insertComposerNewline,
  insertComposerText,
  moveComposerCursorDown,
  moveComposerCursorEnd,
  moveComposerCursorHome,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUp,
  replaceComposerText,
} from '../composer/state';
import type {CliComposerState} from '../composer/types';
import {hasTranscriptContent} from '../transcript/model';
import {
  activateCliReviewFocusedSelection,
  advanceCliReviewToNextStep,
  applyCliReviewFormShortcut,
  isPermissionReviewState,
  prepareCliReviewDraftInput,
  prepareCliReviewSubmission,
  resolveCliReviewFocusedFooterAction,
  selectNextCliReviewTab,
  selectNextCliReviewAction,
  selectPreviousCliReviewTab,
  selectPreviousCliReviewAction,
  toggleCliReviewFocus,
  updateCliReviewDraft,
  setPermissionStage,
  type CliReviewAutoAction,
} from './review-state';
import {
  appendInteractionText,
  applyInteractionChunkToTurn,
  containsAgentLaunchChatter,
  finalizeBufferedInteractionText,
  sealActiveTurnAtRuntimeBoundary,
} from './interaction-turn';
import {
  CliInteractionScheduler,
  type QueuedReviewResponseInteraction,
} from './interaction-scheduler';
import {readCliReviewProjection, syncProjectedReview} from './runtime-projection';
import {routeCliRuntimeEvent} from './runtime-event-router';
import type {
  CliActiveTurn,
  CliInteractionSurface,
  CliInteractionKind,
  CliInteractionState,
  CliNotice,
  CliReviewState,
  CliRunState,
} from './view-state';

const STARTUP_MESSAGE = '';
const REVIEW_AUTO_ACTION_DELAY_MS = 30;
const REVIEW_QUEUE_HANDOFF_TIMEOUT_MS = 500;
const REVIEW_QUEUE_HANDOFF_POLL_MS = 10;
const REVIEW_RESUME_READY_TIMEOUT_MS = 500;
const REVIEW_RESUME_READY_POLL_MS = 10;
const PROMPT_SETTLE_REFRESH_TIMEOUT_MS = 500;
const PROMPT_SETTLE_REFRESH_POLL_MS = 20;
const FINAL_REPLY_SETTLE_POLL_MS = 80;

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

function appendUniqueNotices(current: CliNotice[], incoming: readonly CliNotice[]): CliNotice[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((notice) => notice.id));
  const unique = incoming.filter((notice) => !seen.has(notice.id));
  return unique.length > 0 ? [...current, ...unique] : current;
}

function deriveRunStateFromAgentState(nextAgentState: {status: string; pendingReview?: unknown}): CliRunState {
  if (nextAgentState.pendingReview || nextAgentState.status === 'paused') {
    return {status: 'paused'};
  }

  if (nextAgentState.status === 'running') {
    return {status: 'running'};
  }

  return {status: 'done'};
}

function hasTrackedForegroundSubagentRuns(codara: Pick<Codara, 'getSubagentRunSummaries'>): boolean {
  return codara.getSubagentRunSummaries().some((run) => run.status === 'running' || run.status === 'paused');
}

function shouldKeepPromptTurnRunningAfterAgentLaunch(input: {
  nextAgentState: {status: string};
  codara: Pick<Codara, 'getSubagentRunSummaries'>;
  launchedAgent: boolean;
  sawVisibleReply: boolean;
}): boolean {
  // Foreground subagents still running — always wait for them.
  if (hasTrackedForegroundSubagentRuns(input.codara)) {
    return true;
  }

  // An agent was launched: keep running regardless of preamble text or agent state.
  // Subagents may not be registered in getSubagentRunSummaries yet (async startup),
  // so we hand off to the useEffect polling loop which confirms completion via
  // refreshCoreState() instead of relying on stale snapshots here.
  if (input.launchedAgent) {
    return true;
  }

  // No agent launched (plain tool call): if the main loop already produced a visible
  // reply, the turn is effectively done — don't keep spinning.
  if (input.sawVisibleReply) {
    return false;
  }

  return input.nextAgentState.status === 'running';
}

function hasVisibleAssistantReply(
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

function activeTurnOwnsVisibleTranscript(
  turn: CliActiveTurn | undefined,
  subagentRuns?: readonly SubagentRunQuerySummary[],
): boolean {
  if (!turn) {
    return false;
  }

  return hasVisibleAssistantReply(turn, subagentRuns) || Boolean(turn.thinking?.trim());
}

function hasVisibleMainAssistantText(
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

function hasVisibleAssistantReplyInMessages(
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

function shouldContinuePollingForPromptSettlement(input: {
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

function resolveHydratedCoreMessages(input: {
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

function appendRuntimeEventPreservingOpenStarts(
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

function resolveFocusedSurface(
  current: CliInteractionSurface,
  review: CliReviewState | undefined,
): CliInteractionSurface {
  if (!review) {
    return 'prompt';
  }
  return 'review';
}

function shouldHandoffForegroundTurnToReview(review: CliReviewState | undefined): boolean {
  return review?.request.action.toolName === 'AskUserQuestion';
}

function suppressActiveTurnForReview(
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

async function waitForForegroundReviewResumeReady(
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
    setInteractionState((current) => {
      const snapshot = interactionScheduler.readSnapshot();
      const focusedSurface = resolveFocusedSurface(current.focusedSurface, reviewRef.current);
      return {
        focusedSurface,
        activeKind: snapshot.activeKind,
        pendingCount: snapshot.pendingCount,
        promptBlocked: focusedSurface !== 'prompt',
      };
    });
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

    if (reviewRef.current) {
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

      await new Promise((resolve) => setTimeout(resolve, PROMPT_SETTLE_REFRESH_POLL_MS));
    }

    return false;
  }, [codara, refreshCoreState, settleRunningPromptTurnIfReady]);

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
    if (interactionScheduler.isRunning()) {
      return;
    }
    const nextInteraction = interactionScheduler.takeNextInteraction();
    if (nextInteraction) {
      syncInteractionState();
      void (async () => {
        let handled = true;
        if (nextInteraction.kind === 'session_prompt') {
          await runQueuedSessionPromptRef.current(nextInteraction.prompt);
        } else {
          handled = await runQueuedReviewResponse(nextInteraction);
        }
        flushPendingBackgroundNotices();
        if (handled) {
          drainScheduledInteractions();
        }
      })();
      return;
    }

    syncInteractionState();
  }, [flushPendingBackgroundNotices, interactionScheduler, runQueuedReviewResponse, syncInteractionState]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
      const route = routeCliRuntimeEvent({
        event,
        interactionRunning: interactionScheduler.isRunning(),
      });

      setRuntimeEvents((current) => appendRuntimeEventPreservingOpenStarts(current, event));
      if (route.shouldSealActiveTurn) {
        setActiveTurn((current) => sealActiveTurnAtRuntimeBoundary(current));
      }

      if (route.immediateNotice) {
        setNotices((current) => appendUniqueNotices(current, [route.immediateNotice!]));
      }
      if (route.queuedNotice) {
        pendingBackgroundNoticesRef.current = appendUniqueNotices(
          pendingBackgroundNoticesRef.current,
          [route.queuedNotice],
        );
      }
      if (route.foregroundSubagentReview) {
        endInteraction();
        setRunState({status: 'paused'});
        refreshAuxiliaryState();
        return;
      }

      const shouldRefreshDuringRunningAgentHandoff = event.kind === 'agent'
        && (
          event.phase === 'end'
          || (event.phase === 'update' && event.status === 'paused')
        );

      if (shouldRefreshDuringRunningAgentHandoff || route.shouldRefreshAuxiliaryState) {
        if (event.kind === 'agent') {
          void refreshCoreState()
            .then((nextAgentState) => {
              const settled = settleRunningPromptTurnIfReady(nextAgentState.messages);
              if (!settled && event.phase === 'end') {
                if (
                  runStateRef.current.status === 'running'
                  && runStateRef.current.phase === 'subagent_wait'
                  && !hasTrackedForegroundSubagentRuns(codara)
                ) {
                  setRunState({status: 'running', phase: 'subagent_completion'});
                }
                void refreshCoreStateUntilPromptSettles();
              }
              return nextAgentState;
            })
            .catch(() => {
              refreshAuxiliaryState();
            });
        } else {
          refreshAuxiliaryState();
        }
      }

      if (event.kind === 'agent') {
        queueMicrotask(() => {
          drainScheduledInteractions();
        });
      }
    });
  }, [codara, drainScheduledInteractions, endInteraction, interactionScheduler, refreshAuxiliaryState, refreshCoreState, refreshCoreStateUntilPromptSettles, setActiveTurn, settleRunningPromptTurnIfReady, syncInteractionState]);

  useEffect(() => {
    settleRunningPromptTurnIfReady(coreMessages);
  }, [coreMessages, settleRunningPromptTurnIfReady]);

  useEffect(() => {
    const visibleReplyInActiveTurn = hasVisibleAssistantReply(activeTurn, codara.getSubagentRunSummaries());
    const visibleReplyInMessages = hasVisibleAssistantReplyInMessages(
      coreMessages,
      promptStartMessageCountRef.current,
      codara.getSubagentRunSummaries(),
    );
    const visibleReply = visibleReplyInActiveTurn || visibleReplyInMessages;

    if (
      settlingFinalReplyRef.current
      || runState.status !== 'running'
      || review
    ) {
      return;
    }

    if (!visibleReply && hasTrackedForegroundSubagentRuns(codara)) {
      return;
    }

    if (runState.phase !== 'subagent_completion') {
      setRunState({status: 'running', phase: 'subagent_completion'});
    }

    // In subagent_completion phase, always enter the polling loop to wait for
    // the main loop to genuinely finish (don't fast-exit based on stale visibleReply
    // from messages sent before subagents were launched).
    if (runState.phase !== 'subagent_completion') {
      return;
    }

    settlingFinalReplyRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        while (!cancelled) {
          const nextAgentState = await refreshCoreState();
          if (nextAgentState.pendingReview || nextAgentState.status === 'paused') {
            break;
          }

          const hasVisibleReplyInActiveTurn = hasVisibleAssistantReply(activeTurnRef.current, codara.getSubagentRunSummaries());
          const hasStableVisibleReply = hasVisibleAssistantReplyInMessages(
            nextAgentState.messages,
            promptStartMessageCountRef.current,
            codara.getSubagentRunSummaries(),
          );
          if (hasStableVisibleReply) {
            setRunState({status: 'done'});
            setActiveTurn(undefined);
            break;
          }

          if (hasVisibleReplyInActiveTurn) {
            setRunState({status: 'done'});
            break;
          }

          if (nextAgentState.status !== 'running') {
            settleRunningPromptTurnIfReady(nextAgentState.messages);
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, FINAL_REPLY_SETTLE_POLL_MS));
        }
      } catch (error) {
        reportError(error);
      } finally {
        settlingFinalReplyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTurn,
    codara,
    coreMessages,
    refreshCoreState,
    reportError,
    review,
    runState.phase,
    runState.status,
    settleRunningPromptTurnIfReady,
    setActiveTurn,
  ]);

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

    if (shouldKeepPromptTurnRunningAfterAgentLaunch({
      nextAgentState,
      codara,
      launchedAgent,
      sawVisibleReply: sawText,
    })) {
      setRunState({
        status: 'running',
        phase: hasTrackedForegroundSubagentRuns(codara)
          ? 'subagent_wait'
          : launchedAgent
            ? 'subagent_completion'
            : 'prompt_stream',
      });
      return;
    }

    if (!sawText) {
      setActiveTurn((current) => current ? {...current, response: '(no output)'} : current);
    }

    setRunState(deriveRunStateFromAgentState(nextAgentState));
    setActiveTurn(undefined);
  }, [codara, refreshCoreState, setActiveTurn]);

  const runQueuedSessionPrompt = useCallback(async (prompt: string): Promise<void> => {
    beginInteraction('session_prompt');
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
    applyComposerChange((current) => insertComposerText(current, input));
  }, [applyComposerChange]);

  const replaceText = useCallback((text: string) => {
    applyComposerChange(() => replaceComposerText(text));
  }, [applyComposerChange]);

  const insertNewline = useCallback(() => {
    applyComposerChange((current) => insertComposerNewline(current));
  }, [applyComposerChange]);

  const backspace = useCallback(() => {
    applyComposerChange((current) => backspaceComposerText(current));
  }, [applyComposerChange]);

  const moveCursorLeft = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorLeft(current));
  }, [applyComposerChange]);

  const moveCursorRight = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorRight(current));
  }, [applyComposerChange]);

  const moveCursorUp = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorUp(current));
  }, [applyComposerChange]);

  const moveCursorDown = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorDown(current));
  }, [applyComposerChange]);

  const moveCursorHome = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorHome(current));
  }, [applyComposerChange]);

  const moveCursorEnd = useCallback(() => {
    applyComposerChange((current) => moveComposerCursorEnd(current));
  }, [applyComposerChange]);

  const toggleSubagentRunsPanel = useCallback(() => {
    setSubagentRunPanelVisible(current => !current);
  }, []);

  const toggleExpand = useCallback(() => {
    setExpandedAll(current => !current);
  }, []);

  const dismissCommandOutput = useCallback(() => {
    setCommandOutput(undefined);
  }, []);

  const scrollCommandOutput = useCallback((delta: number) => {
    setCommandOutput((current) => {
      if (!current) return current;
      const totalLines = current.content.split('\n').length;
      const maxOffset = Math.max(0, totalLines - 20);
      const nextOffset = Math.max(0, Math.min(maxOffset, current.scrollOffset + delta));
      if (nextOffset === current.scrollOffset) return current;
      return {...current, scrollOffset: nextOffset};
    });
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
    if (!reviewRef.current) {
      return;
    }
    setInteractionState((current) => ({
      ...current,
      focusedSurface: 'review',
      promptBlocked: true,
    }));
  }, []);

  const focusPromptWindow = useCallback(() => {
    if (reviewRef.current) {
      return;
    }
    setInteractionState((current) => ({
      ...current,
      focusedSurface: 'prompt',
      promptBlocked: false,
    }));
  }, []);

  const selectPreviousReviewAction = useCallback(() => {
    setReviewState((current) => current ? selectPreviousCliReviewAction(current) : current);
  }, [setReviewState]);

  const selectNextReviewAction = useCallback(() => {
    setReviewState((current) => current ? selectNextCliReviewAction(current) : current);
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
    setReviewState((current) => current?.form ? selectPreviousCliReviewTab(current) : current ? toggleCliReviewFocus(current) : current);
  }, [setReviewState]);

  const moveReviewRight = useCallback(() => {
    setReviewState((current) => current?.form ? selectNextCliReviewTab(current) : current ? toggleCliReviewFocus(current) : current);
  }, [setReviewState]);

  const toggleReviewFocus = useCallback(() => {
    setReviewState((current) => current ? toggleCliReviewFocus(current) : current);
  }, [setReviewState]);

  const activateReviewSelection = useCallback(() => {
    setReviewState((current) => current ? activateCliReviewFocusedSelection(current) ?? current : current);
    setRunState({status: 'paused'});
  }, [setReviewState]);

  const insertReviewText = useCallback((input: string) => {
    setReviewState((current) => {
      if (!current) {
        return current;
      }
      const activeTab = current.form?.tabs[current.form.activeTabIndex];
      const customIndex = activeTab ? activeTab.options.length : -1;
      const customInputSelected = current.form
        && current.focus === 'input'
        && current.selectedActionIndex === customIndex;
      const reviewShortcut = applyCliReviewFormShortcut(current, input);
      const isSelectionDigit = /^[1-9]$/.test(input);
      if (reviewShortcut && isSelectionDigit) {
        return reviewShortcut;
      }
      const shouldTypeIntoDraft = Boolean(current.customInputActive || customInputSelected);
      if (shouldTypeIntoDraft && current.focus === 'input') {
        const prepared = prepareCliReviewDraftInput(current) ?? current;
        return updateCliReviewDraft(prepared, prepared.draft + input);
      }
      if (reviewShortcut) {
        return reviewShortcut;
      }
      if (current.focus !== 'input') {
        return current;
      }
      const prepared = prepareCliReviewDraftInput(current);
      if (!prepared) {
        return current;
      }
      return updateCliReviewDraft(prepared, prepared.draft + input);
    });
  }, [setReviewState]);

  const insertReviewNewline = useCallback(() => {
    setReviewState((current) => {
      if (!current || current.focus !== 'input') {
        return current;
      }
      return updateCliReviewDraft(current, `${current.draft}\n`);
    });
  }, [setReviewState]);

  const backspaceReviewInput = useCallback(() => {
    setReviewState((current) => {
      if (!current || current.focus !== 'input' || current.draft.length === 0) {
        return current;
      }
      return updateCliReviewDraft(current, current.draft.slice(0, -1));
    });
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

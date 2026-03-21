import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState, TaskRunQuerySummary} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
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
  confirmCliReviewFocusedSelection,
  prepareCliReviewDraftInput,
  prepareCliReviewSubmission,
  selectNextCliReviewTab,
  selectNextCliReviewAction,
  selectPreviousCliReviewTab,
  selectPreviousCliReviewAction,
  toggleCliReviewFocus,
  updateCliReviewDraft,
  setPermissionStage,
  type CliReviewAutoAction,
} from './review-state';
import {appendInteractionText, applyInteractionChunkToTurn} from './interaction-turn';
import {readCliReviewProjection, syncProjectedReview} from './runtime-projection';
import type {CliActiveTurn, CliInputTarget, CliReviewState, CliNotice, CliRunState} from './view-state';

const STARTUP_MESSAGE = '';
const REVIEW_AUTO_ACTION_DELAY_MS = 30;
const REVIEW_QUEUE_HANDOFF_TIMEOUT_MS = 500;
const REVIEW_QUEUE_HANDOFF_POLL_MS = 10;

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
  inputTarget: CliInputTarget;
  sessionState: SessionState;
  taskPanelVisible: boolean;
  toggleTaskPanel: () => void;
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

function shouldRefreshAuxiliaryState(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task' || event.kind === 'hil';
}

function isDelegatedTaskReviewPause(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task' && event.phase === 'update' && event.status === 'paused';
}

function summarizeBackgroundTaskNotice(event: CodaraRuntimeEvent): CliNotice | undefined {
  if (event.kind !== 'task') {
    return undefined;
  }

  const detail = event.detail?.trim();
  const suffix = detail ? `: ${detail}` : '';

  if (event.phase === 'end') {
    if (event.status === 'error') {
      return {
        id: `task-notice:${event.id}`,
        level: 'error',
        content: `Background task failed${suffix}`,
      };
    }
  }

  if (event.phase === 'update' && event.status === 'paused') {
    return {
      id: `task-notice:${event.id}`,
      level: 'warning',
      content: `Background task waiting for review${suffix}`,
    };
  }

  return undefined;
}

function parseTaskRunIdFromEvent(event: CodaraRuntimeEvent): string | undefined {
  const candidate = event.parentId ?? event.id;
  const prefix = 'task-run:';
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : undefined;
}

interface TrackedTaskBatch {
  sessionId: string;
  expectedCount: number;
  runIds: Set<string>;
  continuationStarted: boolean;
}

interface TaskCompletionHandoff {
  runId: string;
  label: string;
  agentName: string;
  status: 'completed' | 'failed';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

interface TaskCompletionContinuation {
  sessionId: string;
  tasks: TaskCompletionHandoff[];
}

function isRunIdBackedTaskStartEvent(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task'
    && event.phase === 'start'
    && event.status === 'running'
    && Boolean(parseTaskRunIdFromEvent(event));
}

function isPendingTaskPlaceholderStartEvent(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task'
    && event.phase === 'start'
    && event.detail === 'pending';
}

function isTaskRunTerminal(run: TaskRunQuerySummary): boolean {
  return run.status === 'completed' || run.status === 'failed';
}

function toTaskCompletionHandoff(run: TaskRunQuerySummary): TaskCompletionHandoff {
  return {
    runId: run.runId,
    label: run.label,
    agentName: run.agentName,
    status: run.status === 'failed' ? 'failed' : 'completed',
    ...(run.summary?.trim() ? {summary: run.summary.trim()} : {}),
    ...(run.errorMessage?.trim() ? {errorMessage: run.errorMessage.trim()} : {}),
    ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
    ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
  };
}

function resolveTaskCompletionContinuation(
  codara: Codara,
  event: CodaraRuntimeEvent,
  batch: TrackedTaskBatch | undefined,
): TaskCompletionContinuation | undefined {
  if (event.kind !== 'task' || event.phase !== 'end') {
    return undefined;
  }

  const runId = parseTaskRunIdFromEvent(event);
  if (!runId || !batch || batch.continuationStarted || batch.sessionId !== event.sessionId || !batch.runIds.has(runId)) {
    return undefined;
  }

  const taskRuns = codara.getTaskRunSummaries();
  const batchRuns = [...batch.runIds]
    .map((batchRunId) => taskRuns.find((run) => run.runId === batchRunId && run.sessionId === event.sessionId))
    .filter((run): run is TaskRunQuerySummary => Boolean(run));
  if (
    batch.runIds.size < batch.expectedCount
    || batchRuns.length !== batch.runIds.size
    || batchRuns.some((run) => !isTaskRunTerminal(run))
  ) {
    return undefined;
  }

  return {
    sessionId: event.sessionId,
    tasks: batchRuns.map(toTaskCompletionHandoff),
  };
}

function appendUniqueNotices(current: CliNotice[], incoming: readonly CliNotice[]): CliNotice[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((notice) => notice.id));
  const unique = incoming.filter((notice) => !seen.has(notice.id));
  return unique.length > 0 ? [...current, ...unique] : current;
}

function deriveRunStateFromAgentState(nextAgentState: {status: string; pendingPause?: unknown}): CliRunState {
  return nextAgentState.pendingPause || nextAgentState.status === 'paused'
    ? {status: 'paused'}
    : {status: 'done'};
}

function resolveInputTarget(
  current: CliInputTarget,
  review: CliReviewState | undefined,
): CliInputTarget {
  if (!review) {
    return 'prompt';
  }
  if (review.blockingScope === 'session') {
    return 'review';
  }
  return current;
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
  const [activeTurn, setActiveTurn] = useState<CliActiveTurn | undefined>();
  const [review, setReview] = useState<CliReviewState | undefined>();
  const [inputTarget, setInputTarget] = useState<CliInputTarget>('prompt');
  const [coreMessages, setCoreMessages] = useState<readonly BaseMessage[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<readonly CodaraRuntimeEvent[]>([]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());
  const [taskPanelVisible, setTaskPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const [commandOutput, setCommandOutput] = useState<{content: string; commandName?: string; scrollOffset: number} | undefined>();
  const isRunningRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const initialCoreStateLoadedRef = useRef(false);
  const reviewRef = useRef<CliReviewState | undefined>(undefined);
  const autoActionsRef = useRef([...reviewAutoActions]);
  const handledAutoPauseIdsRef = useRef<Set<string>>(new Set());
  const pendingBackgroundNoticesRef = useRef<CliNotice[]>([]);
  const trackedTaskBatchRef = useRef<TrackedTaskBatch | undefined>(undefined);
  const pendingTaskContinuationRef = useRef<TaskCompletionContinuation | undefined>(undefined);

  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

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

  const reportError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setRunState({status: 'error', error: message});
    setActiveTurn(undefined);
    appendNotice('error', message);
    return message;
  }, [appendNotice]);

  const refreshAuxiliaryState = useCallback(() => {
    const projection = readCliReviewProjection(codara);
    const nextReview = syncProjectedReview(codara, reviewRef.current, {
      pendingPause: projection.activePause,
    });
    setSessionState(codara.getState());
    setReview(nextReview);
    setInputTarget((current) => resolveInputTarget(current, nextReview));
  }, [codara]);

  const refreshCoreState = useCallback(async () => {
    const nextAgentState = await codara.hydrate();
    if (!nextAgentState.pendingPause) {
      const queuedReviews = codara.listReviewItems();
      if (queuedReviews.length > 0) {
        await codara.focusReview(queuedReviews[0]!.reviewId);
      }
    }
    setCoreMessages(nextAgentState.messages);
    setSessionState(codara.getState());
    const nextReview = syncProjectedReview(codara, reviewRef.current, {
      pendingPause: nextAgentState.pendingPause,
    });
    setReview(nextReview);
    setInputTarget((current) => resolveInputTarget(current, nextReview));
    return nextAgentState;
  }, [codara]);

  const runTaskCompletionContinuation = useCallback(async (continuation: TaskCompletionContinuation) => {
    if (isRunningRef.current) {
      pendingTaskContinuationRef.current = continuation;
      return;
    }

    isRunningRef.current = true;
    setRunState({status: 'running'});
    setActiveTurn({
      id: `task-continuation-${randomUUID()}`,
      prompt: '',
      response: '',
      responseRole: 'assistant',
      kind: 'task_completion',
    });

    let sawText = false;

    try {
      for await (const chunk of codara.streamInteraction({
        kind: 'continuation',
        context: {
          codaraTaskCompletion: {
            tasks: continuation.tasks,
          },
        },
        config: {
          streamMode: 'messages',
        },
      })) {
        if (!AIMessageChunk.isInstance(chunk)) {
          continue;
        }
        setActiveTurn((current) => {
          const result = applyInteractionChunkToTurn(current, chunk);
          if (result.sawText) {
            sawText = true;
          }
          return result.turn;
        });
      }

      if (!sawText) {
        setActiveTurn((current) => current ? {...current, response: '(no output)'} : current);
      }

      setActiveTurn(undefined);
      trackedTaskBatchRef.current = undefined;
      const nextAgentState = await refreshCoreState();
      setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
    } catch (error) {
      setActiveTurn(undefined);
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
    }
  }, [codara, refreshCoreState, reportError]);

  const drainPendingTaskContinuation = useCallback(() => {
    if (isRunningRef.current || !pendingTaskContinuationRef.current) {
      return;
    }
    const continuation = pendingTaskContinuationRef.current;
    pendingTaskContinuationRef.current = undefined;
    void runTaskCompletionContinuation(continuation);
  }, [runTaskCompletionContinuation]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
      const foregroundDelegatedReview = isDelegatedTaskReviewPause(event);
      if (isPendingTaskPlaceholderStartEvent(event)) {
        const currentBatch = trackedTaskBatchRef.current;
        if (!currentBatch || currentBatch.sessionId !== event.sessionId || currentBatch.continuationStarted) {
          trackedTaskBatchRef.current = {
            sessionId: event.sessionId,
            expectedCount: 1,
            runIds: new Set(),
            continuationStarted: false,
          };
        } else {
          currentBatch.expectedCount += 1;
        }
      }
      if (isRunIdBackedTaskStartEvent(event)) {
        const runId = parseTaskRunIdFromEvent(event)!;
        const currentBatch = trackedTaskBatchRef.current;
        if (!currentBatch || currentBatch.sessionId !== event.sessionId || currentBatch.continuationStarted) {
          trackedTaskBatchRef.current = {
            sessionId: event.sessionId,
            expectedCount: 1,
            runIds: new Set([runId]),
            continuationStarted: false,
          };
        } else {
          currentBatch.runIds.add(runId);
          currentBatch.expectedCount = Math.max(currentBatch.expectedCount, currentBatch.runIds.size);
        }
      }
      setRuntimeEvents((current) => [...current, event].slice(-40));
      const completionContinuation = resolveTaskCompletionContinuation(codara, event, trackedTaskBatchRef.current);
      if (completionContinuation && trackedTaskBatchRef.current) {
        trackedTaskBatchRef.current.continuationStarted = true;
      }
      if (!isRunningRef.current && !foregroundDelegatedReview) {
        const notice = summarizeBackgroundTaskNotice(event);
        if (notice) {
          setNotices((current) => appendUniqueNotices(current, [
            notice,
          ]));
        }
        if (completionContinuation) {
          void runTaskCompletionContinuation(completionContinuation);
        }
      } else if (!foregroundDelegatedReview) {
        const notice = summarizeBackgroundTaskNotice(event);
        const queued = [
          ...(notice ? [notice] : []),
        ];
        if (queued.length > 0) {
          pendingBackgroundNoticesRef.current = appendUniqueNotices(
            pendingBackgroundNoticesRef.current,
            queued,
          );
        }
        if (completionContinuation) {
          pendingTaskContinuationRef.current = completionContinuation;
          queueMicrotask(() => {
            drainPendingTaskContinuation();
          });
        }
      }

      if (foregroundDelegatedReview) {
        isRunningRef.current = false;
        setRunState({status: 'paused'});
        refreshAuxiliaryState();
        return;
      }

      if (!isRunningRef.current && shouldRefreshAuxiliaryState(event)) {
        refreshAuxiliaryState();
      }
    });
  }, [codara, drainPendingTaskContinuation, refreshAuxiliaryState, runTaskCompletionContinuation]);

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
    setActiveTurn({
      id: `turn-${randomUUID()}`,
      prompt,
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    });

    let sawText = false;

    for await (const chunk of codara.streamInteraction({
      kind: 'prompt',
      input: prompt,
      config: {streamMode: 'messages'},
    })) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }
      setActiveTurn((current) => {
        const result = applyInteractionChunkToTurn(current, chunk, {
          captureThinking: true,
          detectTaskLaunch: true,
        });
        if (result.sawText) {
          sawText = true;
        }
        return result.turn;
      });
    }

    if (!sawText) {
      setActiveTurn((current) => current ? {...current, response: '(no output)'} : current);
    }

    setActiveTurn(undefined);
    const nextAgentState = await refreshCoreState();
    setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
  }, [codara, refreshCoreState]);

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    const prompt = rawPrompt.trim();
    if (!prompt || isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    setRunState({status: 'running'});
    setRuntimeEvents([]);
    setCommandOutput(undefined);

    try {
      if (prompt.startsWith('/')) {
        await runSlashCommand(prompt);
        return;
      }

      await runAgentPrompt(prompt);
    } catch (error) {
      // Clear activeTurn so UI doesn't stay stuck in "waiting" state
      setActiveTurn(undefined);
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
      if (pendingBackgroundNoticesRef.current.length > 0) {
        const queued = pendingBackgroundNoticesRef.current;
        pendingBackgroundNoticesRef.current = [];
        setNotices((current) => appendUniqueNotices(current, queued));
      }
      if (pendingTaskContinuationRef.current) {
        drainPendingTaskContinuation();
      }
    }
  }, [drainPendingTaskContinuation, refreshCoreState, reportError, runAgentPrompt, runSlashCommand]);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      void codara.dispose().catch(() => undefined);
    };
  }, [codara]);

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

  const toggleTaskPanel = useCallback(() => {
    setTaskPanelVisible(current => !current);
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
    setInputTarget('review');
  }, []);

  const focusPromptWindow = useCallback(() => {
    if (reviewRef.current?.blockingScope === 'session') {
      return;
    }
    setInputTarget('prompt');
  }, []);

  const selectPreviousReviewAction = useCallback(() => {
    setReview((current) => current ? selectPreviousCliReviewAction(current) : current);
  }, []);

  const selectNextReviewAction = useCallback(() => {
    setReview((current) => current ? selectNextCliReviewAction(current) : current);
  }, []);

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
    setReview((current) => current?.form ? selectPreviousCliReviewTab(current) : current ? toggleCliReviewFocus(current) : current);
  }, []);

  const moveReviewRight = useCallback(() => {
    setReview((current) => current?.form ? selectNextCliReviewTab(current) : current ? toggleCliReviewFocus(current) : current);
  }, []);

  const toggleReviewFocus = useCallback(() => {
    setReview((current) => current ? toggleCliReviewFocus(current) : current);
  }, []);

  const activateReviewSelection = useCallback(() => {
    setReview((current) => current ? activateCliReviewFocusedSelection(current) ?? current : current);
    setRunState({status: 'paused'});
  }, []);

  const insertReviewText = useCallback((input: string) => {
    setReview((current) => {
      if (!current) {
        return current;
      }
      const shortcut = applyCliReviewFormShortcut(current, input);
      if (shortcut) {
        return shortcut;
      }
      if (current.focus !== 'input') {
        return current;
      }
      const prepared = prepareCliReviewDraftInput(current) ?? current;
      return updateCliReviewDraft(prepared, prepared.draft + input);
    });
  }, []);

  const insertReviewNewline = useCallback(() => {
    setReview((current) => {
      if (!current || current.focus !== 'input') {
        return current;
      }
      return updateCliReviewDraft(current, `${current.draft}\n`);
    });
  }, []);

  const backspaceReviewInput = useCallback(() => {
    setReview((current) => {
      if (!current || current.focus !== 'input' || current.draft.length === 0) {
        return current;
      }
      return updateCliReviewDraft(current, current.draft.slice(0, -1));
    });
  }, []);

  const submitReviewAction = useCallback(async (autoAction?: CliReviewAutoAction) => {
    const currentReview = reviewRef.current ?? review;
    if (!currentReview || isRunningRef.current) {
      return;
    }

    if (!autoAction && currentReview.form && currentReview.focus !== 'actions') {
      const activated = confirmCliReviewFocusedSelection(currentReview);
      if (activated) {
        setReview(activated);
        setRunState({status: 'paused'});
        return;
      }
    }

    if (!autoAction && currentReview.form && !currentReview.form.endStep && currentReview.focus === 'actions') {
      const advanced = advanceCliReviewToNextStep(currentReview);
      setReview(advanced);
      setRunState({status: 'paused'});
      return;
    }

    const prepared = prepareCliReviewSubmission(currentReview, autoAction);
    if (!prepared.payload) {
      setReview(prepared.review);
      setRunState({status: 'paused'});
      return;
    }

    isRunningRef.current = true;
    setRunState({status: 'running'});

    try {
      const selectedAction = autoAction
        ? prepared.review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
        : prepared.review.actions[prepared.review.selectedActionIndex];
      if (!prepared.review.form && !isPermissionReview(prepared.review)) {
        appendNotice('system', `Review action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }

      // Use streaming resume for immediate UI feedback (like Claude Code)
      const focusedReview = codara.getFocusedReview();
      const reviewMatchesCurrentReview = focusedReview?.request.id === prepared.review.request.id;
      if (reviewMatchesCurrentReview) {
        const queuedReviewCount = codara.listReviewItems().length;
        if (queuedReviewCount <= 1) {
          setReview(undefined);
          setInputTarget('prompt');
          setRunState({status: 'done'});
          isRunningRef.current = false;
          void codara.resumeReview(prepared.payload, {streamMode: 'messages'})
            .catch((error) => {
              reportError(error);
            })
            .finally(() => {
              void refreshCoreState().catch(() => undefined);
              if (pendingTaskContinuationRef.current) {
                drainPendingTaskContinuation();
              }
            });
          return;
        }

        const busyReview = reviewRef.current?.request.id === prepared.review.request.id
          ? {...reviewRef.current, busy: true}
          : {...prepared.review, busy: true};
        reviewRef.current = busyReview;
        setReview(busyReview);
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
              const activePause = readCliReviewProjection(codara, {
                pendingPause: nextAgentState.pendingPause,
              }).activePause;
              const stillShowingCurrent = reviews.some((review) => review.reviewId === currentReviewId);
              if (!stillShowingCurrent) {
                const nextReview = syncProjectedReview(codara, reviewRef.current, {pendingPause: activePause});
                setReview(nextReview);
                setInputTarget((current) => resolveInputTarget(current, nextReview));
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
            isRunningRef.current = false;
            if (pendingTaskContinuationRef.current) {
              drainPendingTaskContinuation();
            }
          }
        })();
        return;
      }

      const resumeStream = codara.streamInteraction({
        kind: reviewMatchesCurrentReview ? 'review' : 'pause',
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
      setRunState(nextAgentState.pendingPause || nextAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
      if (pendingTaskContinuationRef.current) {
        drainPendingTaskContinuation();
      }
    }
  }, [appendNotice, codara, drainPendingTaskContinuation, refreshCoreState, reportError, review]);

  const quickReviewAction = useCallback((actionId: string) => {
    // Three-stage permission flow: intercept dont_ask_again and deny
    if (actionId === 'dont_ask_again') {
      setReview((current) => current ? setPermissionStage(current, 'always-confirm') : current);
      return;
    }
    if (actionId === 'deny') {
      setReview((current) => current ? setPermissionStage(current, 'reject-feedback') : current);
      return;
    }
    void submitReviewAction({action: actionId});
  }, [submitReviewAction]);

  const permissionBack = useCallback(() => {
    setReview((current) => current ? setPermissionStage(current, 'prompt') : current);
  }, []);

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
    if (!review || isRunningRef.current || autoActionsRef.current.length === 0) {
      return;
    }

    if (handledAutoPauseIdsRef.current.has(review.request.id)) {
      return;
    }

    handledAutoPauseIdsRef.current.add(review.request.id);
    const nextAction = autoActionsRef.current.shift();
    if (!nextAction) {
      return;
    }

    const timer = setTimeout(() => {
      void submitReviewAction(nextAction);
    }, REVIEW_AUTO_ACTION_DELAY_MS);

    return () => clearTimeout(timer);
  }, [review, submitReviewAction]);

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
    inputTarget,
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
    taskPanelVisible,
    toggleTaskPanel,
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
    inputTarget,
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
    taskPanelVisible,
    toggleExpand,
    toggleReviewFocus,
    toggleTaskPanel,
    coreMessages,
  ]);
}

function isPermissionReview(review: CliReviewState): boolean {
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

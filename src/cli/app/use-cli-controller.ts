import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ApprovalQuerySummary, Codara, CodaraRuntimeEvent, SessionState, TaskRunQuerySummary, TeamQueryDetail} from '@/index';
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
  activateCliHilFocusedSelection,
  advanceCliHilToNextStep,
  applyCliHilFormShortcut,
  confirmCliHilFocusedSelection,
  isPermissionReviewState,
  prepareCliHilDraftInput,
  prepareCliHilSubmission,
  selectNextCliHilTab,
  selectNextCliHilAction,
  selectPreviousCliHilTab,
  selectPreviousCliHilAction,
  syncCliHilReviewState,
  toggleCliHilFocus,
  updateCliHilDraft,
  type CliHilAutoAction,
} from './hil-review';
import type {CliActiveTurn, CliHilReviewState, CliNotice, CliRunState} from './view-state';
import type {TeamDashboardState} from '../hooks/use-team-dashboard';
import type {TeamDetailState} from '../hooks/use-team-detail';
import {shouldRetryTaskCloseoutResponse} from '../task-closeout';

const STARTUP_MESSAGE = '';
const HIL_AUTO_ACTION_DELAY_MS = 30;
const APPROVAL_QUEUE_HANDOFF_TIMEOUT_MS = 500;
const APPROVAL_QUEUE_HANDOFF_POLL_MS = 10;

export interface UseCliControllerOptions {
  codara: Codara;
  initialPrompt?: string;
  startupMessage?: string;
  hilAutoActions?: CliHilAutoAction[];
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
  hilReview?: CliHilReviewState;
  coreMessages: readonly BaseMessage[];
  runtimeEvents: readonly CodaraRuntimeEvent[];
  latestRuntimeEvent?: CodaraRuntimeEvent;
  hasConversation: boolean;
  runState: CliRunState;
  sessionState: SessionState;
  visibleTaskRunIds: readonly string[];
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
  moveHilLeft: () => void;
  moveHilRight: () => void;
  selectPreviousHilAction: () => void;
  selectNextHilAction: () => void;
  selectPreviousApproval: () => void;
  selectNextApproval: () => void;
  toggleHilFocus: () => void;
  activateHilSelection: () => void;
  insertHilText: (input: string) => void;
  insertHilNewline: () => void;
  backspaceHilInput: () => void;
  submitHilAction: () => void;
  quickHilAction: (actionId: string) => void;
  permissionBack: () => void;
  permissionConfirm: () => void;
  permissionRejectSend: () => void;
  permissionRejectSilent: () => void;
  teamDashboardState: TeamDashboardState;
  teamDetailState?: TeamDetailState;
  enterTeam: (teamId: string) => void;
  leaveTeam: () => void;
}

function shouldRefreshAuxiliaryState(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task' || event.kind === 'team' || event.kind === 'hil';
}

function isDelegatedTaskReviewPause(event: CodaraRuntimeEvent): boolean {
  return event.kind === 'task' && event.phase === 'update' && event.status === 'paused';
}

function applyApprovalMetadata(
  review: CliHilReviewState | undefined,
  approvals: readonly ApprovalQuerySummary[],
): CliHilReviewState | undefined {
  if (!review) {
    return undefined;
  }

  const currentIndex = approvals.findIndex((approval) => approval.approvalId === review.request.id);
  return {
    ...review,
    approvalIndex: currentIndex >= 0 ? currentIndex + 1 : undefined,
    approvalCount: approvals.length > 0 ? approvals.length : undefined,
  };
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
  attempt?: number;
  previousInvalidResponse?: string;
}

const MAX_TASK_CLOSEOUT_ATTEMPTS = 2;

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

function isTrackedBatchForContinuation(
  batch: TrackedTaskBatch | undefined,
  continuation: TaskCompletionContinuation,
): boolean {
  if (!batch || batch.sessionId !== continuation.sessionId || batch.runIds.size !== continuation.tasks.length) {
    return false;
  }

  return continuation.tasks.every((task) => batch.runIds.has(task.runId));
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

export function useCliController(options: UseCliControllerOptions): CliController {
  const {
    codara,
    initialPrompt = '',
    startupMessage = STARTUP_MESSAGE,
    hilAutoActions = [],
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
  const [hilReview, setHilReview] = useState<CliHilReviewState | undefined>();
  const [coreMessages, setCoreMessages] = useState<readonly BaseMessage[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<readonly CodaraRuntimeEvent[]>([]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());
  const [taskPanelVisible, setTaskPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const [commandOutput, setCommandOutput] = useState<{content: string; commandName?: string; scrollOffset: number} | undefined>();
  const [teamDashboardState, setTeamDashboardState] = useState<TeamDashboardState>({ teams: [], viewMode: 'dashboard' });
  const [teamDetailState, setTeamDetailState] = useState<TeamDetailState | undefined>();
  const isRunningRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const hilReviewRef = useRef<CliHilReviewState | undefined>(undefined);
  const autoActionsRef = useRef([...hilAutoActions]);
  const handledAutoPauseIdsRef = useRef<Set<string>>(new Set());
  const pendingBackgroundNoticesRef = useRef<CliNotice[]>([]);
  const trackedTaskBatchRef = useRef<TrackedTaskBatch | undefined>(undefined);
  const pendingTaskContinuationRef = useRef<TaskCompletionContinuation | undefined>(undefined);
  const visibleTaskRunIdsRef = useRef<Set<string>>(new Set());
  const [visibleTaskRunIds, setVisibleTaskRunIds] = useState<string[]>([]);

  useEffect(() => {
    hilReviewRef.current = hilReview;
  }, [hilReview]);

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

  const resetVisibleTaskRunIds = useCallback(() => {
    visibleTaskRunIdsRef.current = new Set();
    setVisibleTaskRunIds([]);
  }, []);

  const addVisibleTaskRunId = useCallback((runId: string) => {
    if (visibleTaskRunIdsRef.current.has(runId)) {
      return;
    }

    const next = new Set(visibleTaskRunIdsRef.current);
    next.add(runId);
    visibleTaskRunIdsRef.current = next;
    setVisibleTaskRunIds([...next]);
  }, []);

  const syncTeamDetailState = useCallback(() => {
    const activeTeamId = teamDashboardState.activeTeamId;
    if (!activeTeamId) {
      return;
    }

    const detail: TeamQueryDetail | undefined = codara.getTeamDetail(activeTeamId);
    if (!detail) {
      return;
    }

    setTeamDetailState((prev) => prev ? {
      ...prev,
      status: detail.status,
      members: detail.members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        role: member.role,
        status: member.status,
        model: member.model,
        currentJobId: member.currentJobId,
        tokens: 0,
      })),
      jobs: detail.jobs.map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        assignee: job.assignee,
        blockedBy: job.blockedBy,
      })),
    } : prev);
  }, [codara, teamDashboardState.activeTeamId]);

  const refreshAuxiliaryState = useCallback(() => {
    const focusedApproval = codara.getFocusedApprovalReview();
    const approvals = codara.getApprovalSummaries();
    let foregroundPause;
    try {
      foregroundPause = codara.getAgentState().pendingPause;
    } catch {
      foregroundPause = undefined;
    }

    setSessionState(codara.getState());
    setHilReview((current) => applyApprovalMetadata(
      syncCliHilReviewState(current, focusedApproval?.request ?? foregroundPause),
      approvals,
    ));
    syncTeamDetailState();
  }, [codara, syncTeamDetailState]);

  const refreshCoreState = useCallback(async () => {
    const nextAgentState = await codara.hydrate();
    if (!nextAgentState.pendingPause) {
      const queuedApprovals = codara.getApprovalSummaries();
      if (queuedApprovals.length > 0) {
        await codara.focusApproval(queuedApprovals[0]!.approvalId);
      }
    }
    const focusedApproval = codara.getFocusedApprovalReview();
    setCoreMessages(nextAgentState.messages);
    setSessionState(codara.getState());
    setHilReview((current) => applyApprovalMetadata(
      syncCliHilReviewState(current, focusedApproval?.request ?? nextAgentState.pendingPause),
      codara.getApprovalSummaries(),
    ));
    syncTeamDetailState();
    return nextAgentState;
  }, [codara, syncTeamDetailState]);

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

    try {
      let attempt = continuation.attempt ?? 1;
      let previousInvalidResponse = continuation.previousInvalidResponse;
      while (attempt <= MAX_TASK_CLOSEOUT_ATTEMPTS) {
        let sawText = false;
        let sawTaskToolCall = false;
        let streamedResponse = '';
        setActiveTurn((current) => current ? {...current, response: '', streamingTokens: undefined} : current);

        for await (const chunk of codara.stream(undefined, {
          streamMode: 'messages',
          context: {
            codaraTaskCompletion: {
              tasks: continuation.tasks,
              ...(attempt > 1 ? {attempt} : {}),
              ...(previousInvalidResponse ? {previousInvalidResponse} : {}),
            },
          },
        })) {
          if (!AIMessageChunk.isInstance(chunk)) {
            continue;
          }

          if (Array.isArray(chunk.tool_calls) && chunk.tool_calls.some((toolCall) => toolCall?.name === 'Task')) {
            sawTaskToolCall = true;
          }

          const usageMeta = chunk.usage_metadata as Record<string, unknown> | undefined;
          if (usageMeta) {
            const inputDelta = typeof usageMeta.input_tokens === 'number' ? usageMeta.input_tokens : 0;
            const outputDelta = typeof usageMeta.output_tokens === 'number' ? usageMeta.output_tokens : 0;
            if (inputDelta > 0 || outputDelta > 0) {
              setActiveTurn((current) => {
                if (!current) return current;
                const prev = current.streamingTokens ?? {input: 0, output: 0};
                return {
                  ...current,
                  streamingTokens: {
                    input: Math.max(prev.input, inputDelta),
                    output: Math.max(prev.output, outputDelta),
                  },
                };
              });
            }
          }

          const text = chunk.text;
          if (!text) {
            continue;
          }

          sawText = true;
          streamedResponse += text;
          setActiveTurn((current) => current ? {...current, response: current.response + text} : current);
        }

        const finalResponse = sawText ? streamedResponse : '(no output)';
        if (!sawText) {
          setActiveTurn((current) => current ? {...current, response: finalResponse} : current);
        }

        if (!shouldRetryTaskCloseoutResponse({
          text: finalResponse,
          launchedTaskToolCall: sawTaskToolCall,
          attempt,
          maxAttempts: MAX_TASK_CLOSEOUT_ATTEMPTS,
        })) {
          break;
        }

        previousInvalidResponse = finalResponse.trim();
        attempt += 1;
      }

      setActiveTurn(undefined);
      if (isTrackedBatchForContinuation(trackedTaskBatchRef.current, continuation)) {
        trackedTaskBatchRef.current = undefined;
      }
      const nextAgentState = await refreshCoreState();
      setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
    } catch (error) {
      setActiveTurn(undefined);
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
      const pending = pendingTaskContinuationRef.current;
      if (pending) {
        pendingTaskContinuationRef.current = undefined;
        queueMicrotask(() => {
          void runTaskCompletionContinuation(pending);
        });
      }
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
        addVisibleTaskRunId(runId);
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
  }, [addVisibleTaskRunId, codara, drainPendingTaskContinuation, refreshAuxiliaryState, runTaskCompletionContinuation]);

  useEffect(() => {
    syncTeamDetailState();
  }, [syncTeamDetailState]);

  const enterTeam = useCallback((teamId: string) => {
    setTeamDashboardState(prev => ({ ...prev, activeTeamId: teamId, viewMode: 'observe' as const }));
    const detail: TeamQueryDetail | undefined = codara.getTeamDetail(teamId);
    if (detail) {
      setTeamDetailState({
        teamId: detail.teamId,
        teamName: detail.name,
        goal: detail.goal,
        status: detail.status,
        members: detail.members.map(m => ({
          memberId: m.memberId,
          name: m.name,
          role: m.role,
          status: m.status,
          model: m.model,
          tokens: 0,
        })),
        jobs: detail.jobs.map(j => ({
          id: j.id,
          title: j.title,
          status: j.status,
          assignee: j.assignee,
          blockedBy: j.blockedBy,
        })),
        activity: [],
        tokenUsage: 0,
        estimatedCost: 0,
      });
    }
  }, [codara]);

  const leaveTeam = useCallback(() => {
    setTeamDashboardState(prev => ({ ...prev, activeTeamId: undefined, viewMode: 'dashboard' as const }));
    setTeamDetailState(undefined);
  }, []);

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

    if (result.action?.type === 'enter_team') {
      enterTeam(result.action.teamId);
      if (result.ok) {
        appendNotice('system', result.output || `Entered team ${result.action.teamId}`);
      } else {
        appendNotice('error', result.output || '(no output)');
      }
      setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
      return;
    }

    if (result.action?.type === 'leave_team') {
      leaveTeam();
      appendNotice('system', result.output || 'Left team view.');
      setRunState({status: 'done'});
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
  }, [appendNotice, codara, enterTeam, leaveTeam, onShowSessionPicker, openFile, refreshCoreState, reopenSession, sessionState.sessionId]);

  const runAgentPrompt = useCallback(async (prompt: string) => {
    setActiveTurn({
      id: `turn-${randomUUID()}`,
      prompt,
      response: '',
      responseRole: 'assistant',
      kind: 'prompt',
    });

    let sawText = false;

    for await (const chunk of codara.stream(prompt, {streamMode: 'messages'})) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }

      // Extract thinking blocks (Extended Thinking / reasoning)
      const thinkingText = extractThinkingText(chunk);
      if (thinkingText) {
        setActiveTurn((current) => current
          ? {...current, thinking: (current.thinking ?? '') + thinkingText}
          : current);
      }

      // Accumulate streaming token counts from usage_metadata
      const usageMeta = chunk.usage_metadata as Record<string, unknown> | undefined;
      if (usageMeta) {
        const inputDelta = typeof usageMeta.input_tokens === 'number' ? usageMeta.input_tokens : 0;
        const outputDelta = typeof usageMeta.output_tokens === 'number' ? usageMeta.output_tokens : 0;
        if (inputDelta > 0 || outputDelta > 0) {
          setActiveTurn((current) => {
            if (!current) return current;
            const prev = current.streamingTokens ?? {input: 0, output: 0};
            return {
              ...current,
              streamingTokens: {
                input: Math.max(prev.input, inputDelta),
                output: Math.max(prev.output, outputDelta),
              },
            };
          });
        }
      }

      if (Array.isArray(chunk.tool_calls) && chunk.tool_calls.some((toolCall) => toolCall?.name === 'Task')) {
        setActiveTurn((current) => current ? {
          ...current,
          pendingTaskLaunch: true,
          suppressTaskLaunchResponse: current.response.length === 0,
        } : current);
      }

      const text = chunk.text;
      if (!text) {
        continue;
      }

      sawText = true;
      setActiveTurn((current) => current ? {
        ...current,
        response: current.response + text,
        ...(current.pendingTaskLaunch ? {} : {suppressTaskLaunchResponse: false}),
      } : current);
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
    resetVisibleTaskRunIds();
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
  }, [drainPendingTaskContinuation, refreshCoreState, reportError, resetVisibleTaskRunIds, runAgentPrompt, runSlashCommand]);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      void codara.dispose().catch(() => undefined);
    };
  }, [codara]);

  useEffect(() => {
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

    // Check for @team mention shorthand: "@team-name rest of message"
    const teamMentionMatch = prompt.match(/^@(\S+)\s+([\s\S]*)/);
    if (teamMentionMatch) {
      const teamName = teamMentionMatch[1]!;
      const message = teamMentionMatch[2]!;
      const teams = codara.getTeamSummaries();
      const matchedTeam = teams.find(t => t.name === teamName);
      if (matchedTeam) {
        setComposer(createComposerState());
        setComposerActivityVersion((current) => current + 1);
        void runSlashCommand(`/team message ${teamName} ${message}`);
        return;
      }
      // Team not found — show error with available team names
      const available = teams.map(t => t.name);
      if (available.length > 0) {
        appendNotice('error', `Team "${teamName}" not found. Available: ${available.join(', ')}`);
      } else {
        appendNotice('error', `Team "${teamName}" not found. No active teams.`);
      }
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void submitPrompt(prompt);
  }, [appendNotice, codara, composer.text, runSlashCommand, submitPrompt]);

  const submitText = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void submitPrompt(prompt);
  }, [submitPrompt]);

  const selectPreviousHilAction = useCallback(() => {
    setHilReview((current) => current ? selectPreviousCliHilAction(current) : current);
  }, []);

  const selectNextHilAction = useCallback(() => {
    setHilReview((current) => current ? selectNextCliHilAction(current) : current);
  }, []);

  const shiftApprovalFocus = useCallback(async (direction: -1 | 1) => {
    const approvals = codara.getApprovalSummaries();
    if (approvals.length < 2) {
      return;
    }

    const currentApprovalId = hilReviewRef.current?.request.id;
    const currentIndex = approvals.findIndex((approval) => approval.approvalId === currentApprovalId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + direction + approvals.length) % approvals.length;
    const nextApproval = approvals[nextIndex];
    if (!nextApproval) {
      return;
    }

    await codara.focusApproval(nextApproval.approvalId);
    const nextAgentState = await refreshCoreState();
    const focusedApproval = codara.getFocusedApprovalReview();
    setHilReview((current) => applyApprovalMetadata(
      syncCliHilReviewState(current, focusedApproval?.request ?? nextAgentState.pendingPause),
      codara.getApprovalSummaries(),
    ));
  }, [codara, refreshCoreState]);

  const selectPreviousApproval = useCallback(() => {
    void shiftApprovalFocus(-1);
  }, [shiftApprovalFocus]);

  const selectNextApproval = useCallback(() => {
    void shiftApprovalFocus(1);
  }, [shiftApprovalFocus]);

  const moveHilLeft = useCallback(() => {
    setHilReview((current) => current?.form ? selectPreviousCliHilTab(current) : current ? toggleCliHilFocus(current) : current);
  }, []);

  const moveHilRight = useCallback(() => {
    setHilReview((current) => current?.form ? selectNextCliHilTab(current) : current ? toggleCliHilFocus(current) : current);
  }, []);

  const toggleHilFocus = useCallback(() => {
    setHilReview((current) => current ? toggleCliHilFocus(current) : current);
  }, []);

  const activateHilSelection = useCallback(() => {
    setHilReview((current) => current ? activateCliHilFocusedSelection(current) ?? current : current);
    setRunState({status: 'paused'});
  }, []);

  const insertHilText = useCallback((input: string) => {
    setHilReview((current) => {
      if (!current) {
        return current;
      }
      const shortcut = applyCliHilFormShortcut(current, input);
      if (shortcut) {
        return shortcut;
      }
      if (current.focus !== 'input') {
        return current;
      }
      const prepared = prepareCliHilDraftInput(current) ?? current;
      return updateCliHilDraft(prepared, prepared.draft + input);
    });
  }, []);

  const insertHilNewline = useCallback(() => {
    setHilReview((current) => {
      if (!current || current.focus !== 'input') {
        return current;
      }
      return updateCliHilDraft(current, `${current.draft}\n`);
    });
  }, []);

  const backspaceHilInput = useCallback(() => {
    setHilReview((current) => {
      if (!current || current.focus !== 'input' || current.draft.length === 0) {
        return current;
      }
      return updateCliHilDraft(current, current.draft.slice(0, -1));
    });
  }, []);

  const submitHilAction = useCallback(async (autoAction?: CliHilAutoAction) => {
    const review = hilReviewRef.current;
    if (!review || isRunningRef.current) {
      return;
    }

    if (!autoAction && review.form && review.focus !== 'actions') {
      const activated = confirmCliHilFocusedSelection(review);
      if (activated) {
        setHilReview(activated);
        setRunState({status: 'paused'});
        return;
      }
    }

    if (!autoAction && review.form && !review.form.endStep && review.focus === 'actions') {
      const advanced = advanceCliHilToNextStep(review);
      setHilReview(advanced);
      setRunState({status: 'paused'});
      return;
    }

    const prepared = prepareCliHilSubmission(review, autoAction);
    if (!prepared.payload) {
      setHilReview(prepared.review);
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
        appendNotice('system', `HIL action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }

      // Use streaming resume for immediate UI feedback (like Claude Code)
      const focusedApproval = codara.getFocusedApprovalReview();
      const approvalMatchesCurrentReview = focusedApproval?.request.id === prepared.review.request.id;
      if (approvalMatchesCurrentReview) {
        const queuedApprovalCount = codara.getApprovalSummaries().length;
        if (queuedApprovalCount <= 1) {
          setHilReview(undefined);
          setRunState({status: 'done'});
          isRunningRef.current = false;
          void codara.resumeApproval(prepared.payload, {streamMode: 'messages'})
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

        setHilReview((current) => current ? {...current, busy: true} : current);
        void (async () => {
          try {
            const currentApprovalId = prepared.review.request.id;
            void codara.resumeApproval(prepared.payload, {streamMode: 'messages'}).catch((error) => {
              reportError(error);
            });

            const deadline = Date.now() + APPROVAL_QUEUE_HANDOFF_TIMEOUT_MS;
            while (Date.now() <= deadline) {
              const nextAgentState = await refreshCoreState();
              const approvals = codara.getApprovalSummaries();
              const activePause = codara.getFocusedApprovalReview()?.request ?? nextAgentState.pendingPause;
              const stillShowingCurrent = approvals.some((approval) => approval.approvalId === currentApprovalId);
              if (!stillShowingCurrent) {
                setHilReview((current) => applyApprovalMetadata(
                  syncCliHilReviewState(current, activePause),
                  approvals,
                ));
                setRunState(deriveRunStateFromAgentState(nextAgentState));
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, APPROVAL_QUEUE_HANDOFF_POLL_MS));
            }

            const nextAgentState = await refreshCoreState();
            const activePause = codara.getFocusedApprovalReview()?.request ?? nextAgentState.pendingPause;
            setHilReview((current) => applyApprovalMetadata(
              syncCliHilReviewState(current, activePause),
              codara.getApprovalSummaries(),
            ));
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

      const resumeStream = approvalMatchesCurrentReview
        ? codara.resumeApprovalStream(prepared.payload, {streamMode: 'messages'})
        : codara.resumePauseStream(prepared.payload, {streamMode: 'messages'});
      for await (const chunk of resumeStream) {
        if (!AIMessageChunk.isInstance(chunk)) continue;
        const text = chunk.text;
        if (text) {
          setActiveTurn((current) => current
            ? {...current, response: current.response + text}
            : {id: `turn-resume-${Date.now()}`, prompt: '', response: text, responseRole: 'assistant'});
        }
      }

      setActiveTurn(undefined);
      const nextAgentState = await refreshCoreState();
      const activePause = codara.getFocusedApprovalReview()?.request ?? nextAgentState.pendingPause;
      setHilReview((current) => applyApprovalMetadata(
        syncCliHilReviewState(current, activePause),
        codara.getApprovalSummaries(),
      ));
      setRunState(activePause ? {status: 'paused'} : nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
      if (pendingTaskContinuationRef.current) {
        drainPendingTaskContinuation();
      }
    }
  }, [appendNotice, codara, drainPendingTaskContinuation, refreshCoreState, reportError]);

  const quickHilAction = useCallback((actionId: string) => {
    void submitHilAction({action: actionId});
  }, [submitHilAction]);

  const permissionBack = useCallback(() => {
    setHilReview((current) => current ? setPermissionStage(current, 'prompt') : current);
  }, []);

  const permissionConfirm = useCallback(() => {
    // Claude Code style: confirm adds all patterns to session memory
    void submitHilAction({action: 'dont_ask_again'});
  }, [submitHilAction]);

  const permissionRejectSend = useCallback(() => {
    const review = hilReviewRef.current;
    if (!review) return;
    void submitHilAction({action: 'deny', comment: review.draft.trim() || undefined});
  }, [submitHilAction]);

  const permissionRejectSilent = useCallback(() => {
    void submitHilAction({action: 'deny'});
  }, [submitHilAction]);

  useEffect(() => {
    if (!hilReview || isRunningRef.current || autoActionsRef.current.length === 0) {
      return;
    }

    if (handledAutoPauseIdsRef.current.has(hilReview.request.id)) {
      return;
    }

    handledAutoPauseIdsRef.current.add(hilReview.request.id);
    const nextAction = autoActionsRef.current.shift();
    if (!nextAction) {
      return;
    }

    const timer = setTimeout(() => {
      void submitHilAction(nextAction);
    }, HIL_AUTO_ACTION_DELAY_MS);

    return () => clearTimeout(timer);
  }, [hilReview, submitHilAction]);

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

  return {
    composer,
    composerActivityVersion,
    notices,
    commandOutput,
    dismissCommandOutput,
    scrollCommandOutput,
    activeTurn,
    hilReview,
    coreMessages,
    runtimeEvents,
    latestRuntimeEvent: runtimeEvents[runtimeEvents.length - 1],
    hasConversation,
    runState,
    sessionState,
    visibleTaskRunIds,
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
    taskPanelVisible,
    toggleTaskPanel,
    expandedAll,
    toggleExpand,
    moveHilLeft,
    moveHilRight,
    selectPreviousHilAction,
    selectNextHilAction,
    selectPreviousApproval,
    selectNextApproval,
    toggleHilFocus,
    activateHilSelection,
    insertHilText,
    insertHilNewline,
    backspaceHilInput,
    submitHilAction: () => {
      void submitHilAction();
    },
    quickHilAction,
    permissionBack,
    permissionConfirm,
    permissionRejectSend,
    permissionRejectSilent,
    teamDashboardState,
    teamDetailState,
    enterTeam,
    leaveTeam,
  };
}

function isPermissionReview(review: CliHilReviewState): boolean {
  return isPermissionReviewState(review);
}

/**
 * Extract thinking/reasoning text from an AIMessageChunk.
 * Anthropic Extended Thinking emits content blocks with type "thinking".
 */
function extractThinkingText(chunk: AIMessageChunk): string | undefined {
  const content = chunk.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  let thinking = '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const typed = block as {type: string; thinking?: string; text?: string};
      if (typed.type === 'thinking' && typed.thinking) {
        thinking += typed.thinking;
      }
    }
  }
  return thinking || undefined;
}

import {randomUUID} from 'node:crypto';
import {useCallback, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {CliComposerState} from '../composer/types';
import {hasTranscriptContent} from '../transcript/model';
import {
  syncCliHilReviewState,
  type CliHilAutoAction,
} from './hil-review';
import type {CliActiveTurn, CliHilReviewState, CliNotice, CliRunState} from './view-state';
import {handleCliCommandHostAction} from './command-host-action';
import {useCliControllerLifecycle} from './controller-lifecycle';
import {resolveCliDraftSubmission} from './draft-submission';
import {useCliHilAutoActions} from './hil-auto-actions';
import {runCliHilExecution} from './hil-execution';
import {createCliHilReviewControls} from './hil-review-controls';
import {runCliPromptExecution} from './prompt-execution';
import {
  appendCliActiveTurnResponse,
  appendCliActiveTurnThinking,
  createCliActiveTurn,
  ensureCliActiveTurnResponse,
  extractCliStreamingTokenCounts,
  extractCliThinkingText,
  mergeCliActiveTurnStreamingTokens,
} from './streaming-active-turn';
import {useCliComposerState} from '../hooks/use-cli-composer-state';
import {useCommandOutputState} from '../hooks/use-command-output-state';
import type {CliCollapsedPasteSummary} from '../composer/collapsed-paste';

const STARTUP_MESSAGE = '';
const HIL_AUTO_ACTION_DELAY_MS = 30;

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
  draftText: string;
  hasDraftContent: boolean;
  collapsedPasteSummary?: CliCollapsedPasteSummary;
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
  moveCursorUp: (terminalWidth?: number) => void;
  moveCursorDown: (terminalWidth?: number) => void;
  moveCursorHome: (terminalWidth?: number) => void;
  moveCursorEnd: (terminalWidth?: number) => void;
  isBrowsingHistory: boolean;
  recallPreviousHistory: () => boolean;
  recallNextHistory: () => boolean;
  submitDraft: () => void;
  submitText: (text: string) => void;
  moveHilLeft: () => void;
  moveHilRight: () => void;
  selectPreviousHilAction: () => void;
  selectNextHilAction: () => void;
  toggleHilFocus: () => void;
  insertHilText: (input: string) => void;
  insertHilNewline: () => void;
  backspaceHilInput: () => void;
  submitHilAction: () => void;
  quickHilAction: (actionId: string) => void;
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
  const [notices, setNotices] = useState<CliNotice[]>(initialNotices);
  const [activeTurn, setActiveTurn] = useState<CliActiveTurn | undefined>();
  const [hilReview, setHilReview] = useState<CliHilReviewState | undefined>();
  const [coreMessages, setCoreMessages] = useState<readonly BaseMessage[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<readonly CodaraRuntimeEvent[]>([]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());
  const [taskPanelVisible, setTaskPanelVisible] = useState(true);
  const [expandedAll, setExpandedAll] = useState(false);
  const isRunningRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const hilReviewRef = useRef<CliHilReviewState | undefined>(undefined);
  const autoActionsRef = useRef([...hilAutoActions]);
  const handledAutoPauseIdsRef = useRef<Set<string>>(new Set());
  const {
    composer,
    draftText,
    hasDraftContent,
    collapsedPasteSummary,
    composerActivityVersion,
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
    isBrowsingHistory,
    recordHistoryEntry,
    recallPreviousHistory,
    recallNextHistory,
    resetComposer,
  } = useCliComposerState();
  const {
    commandOutput,
    clearCommandOutput,
    showCommandOutput,
    scrollCommandOutput,
  } = useCommandOutputState();

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

  const refreshCoreState = useCallback(async () => {
    const nextAgentState = await codara.hydrate();
    setCoreMessages(nextAgentState.messages);
    setSessionState(codara.getState());
    setHilReview((current) => syncCliHilReviewState(current, nextAgentState.pendingPause));
    return nextAgentState;
  }, [codara]);

  const runSlashCommand = useCallback(async (prompt: string) => {
    const result = await codara.executeCommand(prompt);

    const handledHostAction = await handleCliCommandHostAction({
      result,
      sessionId: sessionState.sessionId,
      reopenSession,
      openFile,
      onShowSessionPicker,
      appendNotice,
      setRunState,
    });
    if (handledHostAction) {
      return;
    }

    if (result.ok) {
      showCommandOutput(result.output || '(no output)', result.command);
    } else {
      appendNotice('error', result.output || '(no output)');
    }
    const nextAgentState = await refreshCoreState();
    setRunState(result.ok
      ? nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'}
      : {status: 'error', error: result.output});
  }, [appendNotice, codara, onShowSessionPicker, openFile, refreshCoreState, reopenSession, sessionState.sessionId, showCommandOutput]);

  const runAgentPrompt = useCallback(async (prompt: string) => {
    setActiveTurn(createCliActiveTurn({
      id: `turn-${randomUUID()}`,
      prompt,
    }));

    let sawText = false;

    for await (const chunk of codara.stream(prompt, {streamMode: 'messages'})) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }

      const thinkingText = extractCliThinkingText(chunk);
      if (thinkingText) {
        setActiveTurn((current) => appendCliActiveTurnThinking(current, thinkingText));
      }

      const streamingTokens = extractCliStreamingTokenCounts(chunk);
      if (streamingTokens) {
        setActiveTurn((current) => mergeCliActiveTurnStreamingTokens(current, streamingTokens));
      }

      const text = chunk.text;
      if (!text) {
        continue;
      }

      sawText = true;
      setActiveTurn((current) => appendCliActiveTurnResponse(current, text));
    }

    if (!sawText) {
      setActiveTurn((current) => ensureCliActiveTurnResponse(current));
    }

    setActiveTurn(undefined);
    const nextAgentState = await refreshCoreState();
    setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
  }, [codara, refreshCoreState]);

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    if (isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    try {
      await runCliPromptExecution({
        rawPrompt,
        isRunning: false,
        setRunState,
        clearRuntimeEvents: () => {
          setRuntimeEvents([]);
        },
        clearCommandOutput,
        clearActiveTurn: () => {
          setActiveTurn(undefined);
        },
        runSlashCommand,
        runAgentPrompt,
        reportError,
        refreshCoreState,
      });
    } finally {
      isRunningRef.current = false;
    }
  }, [clearCommandOutput, refreshCoreState, reportError, runAgentPrompt, runSlashCommand]);

  useCliControllerLifecycle({
    codara,
    hilReview,
    hilReviewRef,
    setRuntimeEvents,
    isRunningRef,
    refreshCoreState,
    reportError,
    initialPrompt,
    initialPromptSentRef,
    submitPrompt,
  });

  const toggleTaskPanel = useCallback(() => {
    setTaskPanelVisible(current => !current);
  }, []);

  const toggleExpand = useCallback(() => {
    setExpandedAll(current => !current);
  }, []);

  const submitDraft = useCallback(() => {
    const teams = codara.getTeamSummaries();
    const draftPlan = resolveCliDraftSubmission({
      text: draftText,
      teamNames: teams.map((team) => team.name),
    });

    if (draftPlan.type === 'empty') {
      return;
    }

    if (draftPlan.type === 'team-not-found') {

      // Team not found — show error with available team names
      if (draftPlan.availableTeams.length > 0) {
        appendNotice('error', `Team "${draftPlan.teamName}" not found. Available: ${draftPlan.availableTeams.join(', ')}`);
      } else {
        appendNotice('error', `Team "${draftPlan.teamName}" not found. No active teams.`);
      }
      return;
    }

    recordHistoryEntry(draftText);
    resetComposer();
    if (draftPlan.type === 'team-message') {
      void runSlashCommand(draftPlan.command);
      return;
    }

    void submitPrompt(draftPlan.prompt);
  }, [appendNotice, codara, draftText, recordHistoryEntry, resetComposer, runSlashCommand, submitPrompt]);

  const submitText = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }

    recordHistoryEntry(prompt);
    resetComposer();
    void submitPrompt(prompt);
  }, [recordHistoryEntry, resetComposer, submitPrompt]);

  const submitHilAction = useCallback(async (autoAction?: CliHilAutoAction) => {
    if (isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    // Clear HIL panel immediately — don't show "Running..." while model processes

    try {
      await runCliHilExecution({
        review: hilReviewRef.current,
        autoAction,
        isRunning: false,
        setHilReview,
        setRunState,
        appendNotice,
        streamResumePause: (payload) => codara.resumePauseStream(payload, {streamMode: 'messages'}),
        appendResumeText: (text) => {
          setActiveTurn((current) => current
            ? appendCliActiveTurnResponse(current, text)
            : appendCliActiveTurnResponse(createCliActiveTurn({
                id: `turn-resume-${Date.now()}`,
                prompt: '',
              }), text));
        },
        clearActiveTurn: () => {
          setActiveTurn(undefined);
        },
        refreshCoreState,
        syncHilReviewFromPause: (pendingPause) => {
          setHilReview((current) => syncCliHilReviewState(
            current,
            pendingPause as Parameters<typeof syncCliHilReviewState>[1],
          ));
        },
        reportError,
      });
    } finally {
      isRunningRef.current = false;
    }
  }, [appendNotice, codara, refreshCoreState, reportError]);

  const hilControls = useMemo(() => createCliHilReviewControls({
    setHilReview,
    getCurrentReview: () => hilReviewRef.current,
    submitHilAction,
  }), [submitHilAction]);

  useCliHilAutoActions({
    review: hilReview,
    isRunningRef,
    autoActionsRef,
    handledPauseIdsRef: handledAutoPauseIdsRef,
    submitHilAction,
    delayMs: HIL_AUTO_ACTION_DELAY_MS,
  });

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
    draftText,
    hasDraftContent,
    collapsedPasteSummary,
    composerActivityVersion,
    notices,
    commandOutput,
    dismissCommandOutput: clearCommandOutput,
    scrollCommandOutput,
    activeTurn,
    hilReview,
    coreMessages,
    runtimeEvents,
    latestRuntimeEvent: runtimeEvents[runtimeEvents.length - 1],
    hasConversation,
    runState,
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
    isBrowsingHistory,
    recallPreviousHistory,
    recallNextHistory,
    submitDraft,
    submitText,
    taskPanelVisible,
    toggleTaskPanel,
    expandedAll,
    toggleExpand,
    moveHilLeft: hilControls.moveHilLeft,
    moveHilRight: hilControls.moveHilRight,
    selectPreviousHilAction: hilControls.selectPreviousHilAction,
    selectNextHilAction: hilControls.selectNextHilAction,
    toggleHilFocus: hilControls.toggleHilFocus,
    insertHilText: hilControls.insertHilText,
    insertHilNewline: hilControls.insertHilNewline,
    backspaceHilInput: hilControls.backspaceHilInput,
    submitHilAction: () => {
      void submitHilAction();
    },
    quickHilAction: hilControls.quickHilAction,
    permissionBack: hilControls.permissionBack,
    permissionConfirm: hilControls.permissionConfirm,
    permissionRejectSend: hilControls.permissionRejectSend,
    permissionRejectSilent: hilControls.permissionRejectSilent,
  };
}

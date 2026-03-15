import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState} from '@core';
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
} from '../composer/state';
import type {CliComposerState} from '../composer/types';
import {hasTranscriptContent} from '../transcript/model';
import {
  applyCliHilFormShortcut,
  prepareCliHilSubmission,
  selectNextCliHilTab,
  selectNextCliHilAction,
  selectPreviousCliHilTab,
  selectPreviousCliHilAction,
  syncCliHilReviewState,
  toggleCliHilFocus,
  updateCliHilDraft,
  setPermissionStage,
  type CliHilAutoAction,
} from './hil-review';
import type {CliActiveTurn, CliHilReviewState, CliNotice, CliRunState} from './view-state';

const STARTUP_MESSAGE = '';
const HIL_AUTO_ACTION_DELAY_MS = 30;

export interface UseCliControllerOptions {
  codara: Codara;
  initialPrompt?: string;
  startupMessage?: string;
  hilAutoActions?: CliHilAutoAction[];
  reopenSession?: (sessionId: string) => Promise<void>;
  openFile?: (targetPath: string) => Promise<boolean>;
}

export interface CliController {
  composer: CliComposerState;
  composerActivityVersion: number;
  notices: CliNotice[];
  activeTurn?: CliActiveTurn;
  hilReview?: CliHilReviewState;
  coreMessages: readonly BaseMessage[];
  runtimeEvents: readonly CodaraRuntimeEvent[];
  latestRuntimeEvent?: CodaraRuntimeEvent;
  hasConversation: boolean;
  runState: CliRunState;
  sessionState: SessionState;
  insertText: (input: string) => void;
  insertNewline: () => void;
  backspace: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorUp: () => void;
  moveCursorDown: () => void;
  moveCursorHome: () => void;
  moveCursorEnd: () => void;
  submitDraft: () => void;
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
  const isRunningRef = useRef(false);
  const initialPromptSentRef = useRef(false);
  const hilReviewRef = useRef<CliHilReviewState | undefined>(undefined);
  const autoActionsRef = useRef([...hilAutoActions]);
  const handledAutoPauseIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    hilReviewRef.current = hilReview;
  }, [hilReview]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event) => {
      setRuntimeEvents((current) => [...current, event].slice(-40));
    });
  }, [codara]);

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

    appendNotice(result.ok ? 'system' : 'error', result.output || '(no output)');
    const nextAgentState = await refreshCoreState();
    setRunState(result.ok
      ? nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'}
      : {status: 'error', error: result.output});
  }, [appendNotice, codara, openFile, refreshCoreState, reopenSession, sessionState.sessionId]);

  const runAgentPrompt = useCallback(async (prompt: string) => {
    setActiveTurn({
      id: `turn-${randomUUID()}`,
      prompt,
      response: '',
      responseRole: 'assistant',
    });

    let sawText = false;

    for await (const chunk of codara.stream(prompt, {streamMode: 'messages'})) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }

      const text = chunk.text;
      if (!text) {
        continue;
      }

      sawText = true;
      setActiveTurn((current) => current ? {...current, response: current.response + text} : current);
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

    try {
      if (prompt.startsWith('/')) {
        await runSlashCommand(prompt);
        return;
      }

      await runAgentPrompt(prompt);
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
    }
  }, [refreshCoreState, reportError, runAgentPrompt, runSlashCommand]);

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

  const submitDraft = useCallback(() => {
    const prompt = composer.text.trim();
    if (!prompt) {
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion((current) => current + 1);
    void submitPrompt(prompt);
  }, [composer.text, submitPrompt]);

  const selectPreviousHilAction = useCallback(() => {
    setHilReview((current) => current ? selectPreviousCliHilAction(current) : current);
  }, []);

  const selectNextHilAction = useCallback(() => {
    setHilReview((current) => current ? selectNextCliHilAction(current) : current);
  }, []);

  const moveHilLeft = useCallback(() => {
    setHilReview((current) => current?.form ? selectPreviousCliHilTab(current) : current ? toggleCliHilFocus(current) : current);
  }, []);

  const moveHilRight = useCallback(() => {
    setHilReview((current) => current?.form ? selectNextCliHilTab(current) : current ? toggleCliHilFocus(current) : current);
  }, []);

  const toggleHilFocus = useCallback(() => {
    setHilReview((current) => current ? toggleCliHilFocus(current) : current);
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
      return updateCliHilDraft(current, current.draft + input);
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

    const prepared = prepareCliHilSubmission(review, autoAction);
    if (!prepared.payload) {
      setHilReview(prepared.review);
      setRunState({status: 'paused'});
      return;
    }

    isRunningRef.current = true;
    setRunState({status: 'running'});
    setHilReview((current) => current ? {...prepared.review, busy: true} : current);

    try {
      const selectedAction = autoAction
        ? prepared.review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
        : prepared.review.actions[prepared.review.selectedActionIndex];
      if (!prepared.review.form && !isPermissionReview(prepared.review)) {
        appendNotice('system', `HIL action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }
      const result = await codara.resumePause(prepared.payload);
      setCoreMessages(result.state.messages);
      setSessionState(codara.getState());
      setHilReview((current) => syncCliHilReviewState(current, result.state.pendingPause));
      setRunState(result.state.status === 'paused' ? {status: 'paused'} : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
      setHilReview((current) => current ? {...current, busy: false} : current);
    }
  }, [appendNotice, codara, refreshCoreState, reportError]);

  const quickHilAction = useCallback((actionId: string) => {
    // Three-stage permission flow: intercept dont_ask_again and deny
    if (actionId === 'dont_ask_again') {
      setHilReview((current) => current ? setPermissionStage(current, 'always-confirm') : current);
      return;
    }
    if (actionId === 'deny') {
      setHilReview((current) => current ? setPermissionStage(current, 'reject-feedback') : current);
      return;
    }
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
    activeTurn,
    hilReview,
    coreMessages,
    runtimeEvents,
    latestRuntimeEvent: runtimeEvents[runtimeEvents.length - 1],
    hasConversation,
    runState,
    sessionState,
    insertText,
    insertNewline,
    backspace,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    moveCursorDown,
    moveCursorHome,
    moveCursorEnd,
    submitDraft,
    moveHilLeft,
    moveHilRight,
    selectPreviousHilAction,
    selectNextHilAction,
    toggleHilFocus,
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
  };
}

function isPermissionReview(review: CliHilReviewState): boolean {
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

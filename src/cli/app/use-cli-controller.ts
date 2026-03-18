import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, SessionState, TeamQuerySummary, TeamQueryDetail} from '@/index';
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
import type {TeamDashboardState} from '../hooks/use-team-dashboard';
import type {TeamDetailState} from '../hooks/use-team-detail';

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
  teamDashboardState: TeamDashboardState;
  teamDetailState?: TeamDetailState;
  enterTeam: (teamId: string) => void;
  leaveTeam: () => void;
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

  useEffect(() => {
    hilReviewRef.current = hilReview;
  }, [hilReview]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
      setRuntimeEvents((current) => [...current, event].slice(-40));
      // Auto-refresh team dashboard when team events arrive
      if (event.kind === 'team') {
        const summaries = codara.getTeamSummaries();
        setTeamDashboardState(prev => ({
          ...prev,
          teams: summaries.map((s: TeamQuerySummary) => ({
            teamId: s.teamId,
            name: s.name,
            status: s.status,
            progress: s.jobProgress,
            memberCount: s.memberCount,
            tokenUsage: 0,
            health: 'healthy' as const,
            lastActivity: new Date().toISOString(),
          })),
        }));
      }
    });
  }, [codara]);

  useEffect(() => {
    const activeTeamId = teamDashboardState.activeTeamId;
    if (!activeTeamId) return;
    // Refresh detail state whenever runtime events change (contains team events)
    const detail: TeamQueryDetail | undefined = codara.getTeamDetail(activeTeamId);
    if (detail) {
      setTeamDetailState(prev => prev ? {
        ...prev,
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
      } : prev);
    }
  }, [codara, teamDashboardState.activeTeamId, runtimeEvents]);

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
    // Clear HIL panel immediately — don't show "Running..." while model processes
    setHilReview(undefined);

    try {
      const selectedAction = autoAction
        ? prepared.review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
        : prepared.review.actions[prepared.review.selectedActionIndex];
      if (!prepared.review.form && !isPermissionReview(prepared.review)) {
        appendNotice('system', `HIL action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }

      // Use streaming resume for immediate UI feedback (like Claude Code)
      for await (const chunk of codara.resumePauseStream(prepared.payload, {streamMode: 'messages'})) {
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
      setHilReview((current) => syncCliHilReviewState(current, nextAgentState.pendingPause));
      setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      isRunningRef.current = false;
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
    teamDashboardState,
    teamDetailState,
    enterTeam,
    leaveTeam,
  };
}

function isPermissionReview(review: CliHilReviewState): boolean {
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
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

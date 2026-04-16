/**
 * Hook: usePromptSubmission
 *
 * Manages the full prompt submission lifecycle: slash commands, agent prompts,
 * queued session prompts, and the submit/enqueue decision.
 */
import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useRef} from 'react';
import {isSubagentInternalAssistantText, type Codara, type ReviewRequest, type SessionState} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import {
  appendInteractionText,
  applyInteractionChunkToTurn,
  containsAgentLaunchChatter,
  finalizeBufferedInteractionText,
} from '../interaction-turn';
import type {CliInteractionScheduler} from '../interaction-scheduler';
import {takeNextScheduledInteraction} from '../cli-interaction-queue';
import type {QueuedReviewResponseInteraction} from '../interaction-scheduler';
import {
  hasVisibleAssistantReply,
  hasVisibleAssistantReplyInMessages,
  shouldKeepPromptTurnRunningAfterAgentLaunch,
  appendUniqueNotices,
} from '../cli-controller-logic';
import type {CliEvent} from '../../store/actions';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliNotice,
  CliRunState,
} from '../view-state';

export interface PromptSubmissionDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  initialPrompt: string;
  reviewRef: React.MutableRefObject<import('../view-state').CliReviewState | undefined>;
  activeTurnRef: React.MutableRefObject<CliActiveTurn | undefined>;
  coreMessagesRef: React.MutableRefObject<readonly BaseMessage[]>;
  runStateRef: React.MutableRefObject<CliRunState>;
  promptStartMessageCountRef: React.MutableRefObject<number>;
  pendingBackgroundNoticesRef: React.MutableRefObject<CliNotice[]>;
  settlingFinalReplyRef: React.MutableRefObject<boolean>;
  setActiveTurn: (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => void;
  setRunState: React.Dispatch<React.SetStateAction<CliRunState>>;
  setCommandOutput: React.Dispatch<React.SetStateAction<{content: string; commandName?: string; scrollOffset: number} | undefined>>;
  setRuntimeEvents: React.Dispatch<React.SetStateAction<readonly import('@/index').CodaraRuntimeEvent[]>>;
  sessionState: SessionState;
  beginInteraction: (kind: CliInteractionKind) => void;
  endInteraction: () => void;
  enqueueSessionPrompt: (prompt: string) => void;
  syncInteractionState: () => void;
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  reportError: (error: unknown) => string;
  flushPendingBackgroundNotices: () => void;
  dispatchEvent: (event: CliEvent) => void;
  reopenSession?: (sessionId: string) => Promise<void>;
  openFile?: (targetPath: string) => Promise<boolean>;
  onShowSessionPicker?: () => void;
  runQueuedReviewResponse: (interaction: QueuedReviewResponseInteraction) => Promise<boolean>;
}

export interface PromptSubmissionResult {
  submitPrompt: (rawPrompt: string) => Promise<void>;
  drainScheduledInteractions: () => void;
  /** Ref to the runQueuedSessionPrompt function (for interaction queue) */
  runQueuedSessionPromptRef: React.MutableRefObject<(prompt: string) => Promise<void>>;
}

export function usePromptSubmission(deps: PromptSubmissionDeps): PromptSubmissionResult {
  const {
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
    setRuntimeEvents,
    sessionState,
    beginInteraction,
    endInteraction,
    enqueueSessionPrompt,
    syncInteractionState,
    refreshCoreState,
    appendNotice,
    reportError,
    flushPendingBackgroundNotices,
    dispatchEvent,
    reopenSession,
    openFile,
    onShowSessionPicker,
    runQueuedReviewResponse,
  } = deps;

  const initialPromptSentRef = useRef(false);
  const runQueuedSessionPromptRef = useRef<(prompt: string) => Promise<void>>(async () => undefined);

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

    if (result.action?.type === 'exit') {
      appendNotice('system', result.output || 'Goodbye.');
      setRunState({status: 'done'});
      process.exit(0);
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
  }, [appendNotice, codara, onShowSessionPicker, openFile, refreshCoreState, reopenSession, sessionState.sessionId, setCommandOutput, setRunState]);

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
      setRunState({status: 'running', phase: 'subagent_wait'});
      return;
    }

    if (!sawText) {
      setActiveTurn((current) => current ? {...current, response: '(no output)'} : current);
    }

    setActiveTurn(undefined);
  }, [codara, activeTurnRef, coreMessagesRef, promptStartMessageCountRef, refreshCoreState, setActiveTurn, setRunState]);

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
  }, [beginInteraction, endInteraction, refreshCoreState, reportError, runAgentPrompt, runSlashCommand, setActiveTurn, setCommandOutput, setRuntimeEvents, setRunState, settlingFinalReplyRef]);
  runQueuedSessionPromptRef.current = runQueuedSessionPrompt;

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

    if (runStateRef.current.status === 'running' && runStateRef.current.phase !== 'subagent_wait') {
      settlingFinalReplyRef.current = false;
      setRunState({status: 'done'});
    }
  }, [flushPendingBackgroundNotices, interactionScheduler, runQueuedReviewResponse, runStateRef, settlingFinalReplyRef, setRunState, syncInteractionState]);

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return;
    }

    if (interactionScheduler.isRunning()) {
      enqueueSessionPrompt(prompt);
      return;
    }

    dispatchEvent({type: 'PROMPT_SUBMITTED'});
    await runQueuedSessionPrompt(prompt);
    flushPendingBackgroundNotices();
    drainScheduledInteractions();
  }, [drainScheduledInteractions, enqueueSessionPrompt, flushPendingBackgroundNotices, interactionScheduler, runQueuedSessionPrompt, dispatchEvent]);

  // Initial prompt effect
  useEffect(() => {
    if (!initialPrompt || initialPromptSentRef.current) {
      return;
    }

    initialPromptSentRef.current = true;
    void submitPrompt(initialPrompt);
  }, [initialPrompt, submitPrompt]);

  return {
    submitPrompt,
    drainScheduledInteractions,
    runQueuedSessionPromptRef,
  };
}

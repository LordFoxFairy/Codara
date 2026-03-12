import {randomUUID} from 'node:crypto';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Codara, SessionState} from '@core';
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
import type {CliActiveTurn, CliNotice, CliRunState} from './view-state';

const STARTUP_MESSAGE =
  'Interactive Codara CLI. Type a prompt or slash command and press Enter. Press Ctrl+C or Esc to exit.';
const INITIAL_NOTICE_COUNT = 1;

export interface UseCliControllerOptions {
  codara: Codara;
  initialPrompt?: string;
  startupMessage?: string;
}

export interface CliController {
  composer: CliComposerState;
  composerActivityVersion: number;
  notices: CliNotice[];
  activeTurn?: CliActiveTurn;
  coreMessages: readonly BaseMessage[];
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
}

export function useCliController(options: UseCliControllerOptions): CliController {
  const {codara, initialPrompt = '', startupMessage = STARTUP_MESSAGE} = options;
  const [composer, setComposer] = useState(() => createComposerState());
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [notices, setNotices] = useState<CliNotice[]>([
    {
      id: `system-${randomUUID()}`,
      level: 'system',
      content: startupMessage,
    },
  ]);
  const [activeTurn, setActiveTurn] = useState<CliActiveTurn | undefined>();
  const [coreMessages, setCoreMessages] = useState<readonly BaseMessage[]>([]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const [sessionState, setSessionState] = useState<SessionState>(() => codara.getState());
  const isRunningRef = useRef(false);
  const initialPromptSentRef = useRef(false);

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
  }, [codara]);

  const runSlashCommand = useCallback(async (prompt: string) => {
    const result = await codara.executeCommand(prompt);
    appendNotice(result.ok ? 'system' : 'error', result.output || '(no output)');
    setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
    await refreshCoreState();
  }, [appendNotice, codara, refreshCoreState]);

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

    setRunState({status: 'done'});
    setActiveTurn(undefined);
    await refreshCoreState();
  }, [codara, refreshCoreState]);

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    const prompt = rawPrompt.trim();
    if (!prompt || isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    setRunState({status: 'running'});

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

  const hasConversation = useMemo(
    () => hasTranscriptContent({
      coreMessages,
      notices,
      activeTurn,
      initialNoticeCount: INITIAL_NOTICE_COUNT,
    }),
    [activeTurn, coreMessages, notices],
  );

  return {
    composer,
    composerActivityVersion,
    notices,
    activeTurn,
    coreMessages,
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
  };
}

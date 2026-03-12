import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  createAssistantPlaceholder,
  createCliMessageId,
  createCliSession,
  createStartupMessage,
  extractMessageChunk,
  isSlashCommandPrompt,
  normalizeUserInput,
  renderChunkContent,
  VISIBLE_MESSAGE_LIMIT,
} from '../adapters/agent-session';
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
} from '../state/composer-state';
import type {CliComposerState, CliMessage, CliRunState} from '../state/shell-types';

const INITIAL_PROMPT = process.argv.slice(2).join(' ').trim();

export interface ShellStateModel {
  composer: CliComposerState;
  composerActivityVersion: number;
  visibleMessages: CliMessage[];
  hasConversation: boolean;
  runState: CliRunState;
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

export function useShellState(): ShellStateModel {
  const [codara] = useState(() => createCliSession());
  const [composer, setComposer] = useState(() => createComposerState());
  const [composerActivityVersion, setComposerActivityVersion] = useState(0);
  const [messages, setMessages] = useState<CliMessage[]>([createStartupMessage()]);
  const [runState, setRunState] = useState<CliRunState>({status: 'idle'});
  const runningRef = useRef(false);
  const initialPromptSentRef = useRef(false);

  const submitPrompt = useCallback(async (rawPrompt: string): Promise<void> => {
    // 这里统一处理 slash command 和普通对话，页面层只关心状态和展示。
    const prompt = normalizeUserInput(rawPrompt);
    if (!prompt || runningRef.current) {
      return;
    }

    runningRef.current = true;
    setRunState({status: 'running'});

    const userMessage: CliMessage = {
      id: createCliMessageId('user'),
      role: 'user',
      content: prompt,
    };
    const assistantMessage = createAssistantPlaceholder(prompt);

    setMessages(current => [...current, userMessage, assistantMessage]);

    try {
      if (isSlashCommandPrompt(prompt)) {
        const result = await codara.executeCommand(prompt);
        setMessages(current =>
          current.map(message =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  role: result.ok ? 'system' : 'error',
                  content: result.output || '(no output)',
                }
              : message
          )
        );
        setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
        return;
      }

      let sawText = false;

      for await (const chunk of codara.stream(prompt, {streamMode: 'messages'})) {
        const text = renderChunkContent(extractMessageChunk(chunk)?.content);
        if (!text) {
          continue;
        }

        sawText = true;
        setMessages(current =>
          current.map(message =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: message.content + text,
                }
              : message
          )
        );
      }

      if (!sawText) {
        setMessages(current =>
          current.map(message =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: '(no output)',
                }
              : message
          )
        );
      }

      setRunState({status: 'done'});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunState({status: 'error', error: message});
      setMessages(current => [
        ...current,
        {
          id: createCliMessageId('error'),
          role: 'error',
          content: message,
        },
      ]);
    } finally {
      runningRef.current = false;
    }
  }, [codara]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      void codara.dispose().catch(() => undefined);
    };
  }, [codara]);

  useEffect(() => {
    if (!INITIAL_PROMPT || initialPromptSentRef.current) {
      return;
    }

    initialPromptSentRef.current = true;
    void submitPrompt(INITIAL_PROMPT);
  }, [submitPrompt]);

  const applyComposerChange = useCallback((updater: (current: CliComposerState) => CliComposerState) => {
    setComposer(current => updater(current));
    setComposerActivityVersion(current => current + 1);
  }, []);

  const insertText = useCallback((input: string) => {
    applyComposerChange(current => insertComposerText(current, input));
  }, [applyComposerChange]);

  const insertNewline = useCallback(() => {
    applyComposerChange(current => insertComposerNewline(current));
  }, [applyComposerChange]);

  const backspace = useCallback(() => {
    applyComposerChange(current => backspaceComposerText(current));
  }, [applyComposerChange]);

  const moveCursorLeft = useCallback(() => {
    applyComposerChange(current => moveComposerCursorLeft(current));
  }, [applyComposerChange]);

  const moveCursorRight = useCallback(() => {
    applyComposerChange(current => moveComposerCursorRight(current));
  }, [applyComposerChange]);

  const moveCursorUp = useCallback(() => {
    applyComposerChange(current => moveComposerCursorUp(current));
  }, [applyComposerChange]);

  const moveCursorDown = useCallback(() => {
    applyComposerChange(current => moveComposerCursorDown(current));
  }, [applyComposerChange]);

  const moveCursorHome = useCallback(() => {
    applyComposerChange(current => moveComposerCursorHome(current));
  }, [applyComposerChange]);

  const moveCursorEnd = useCallback(() => {
    applyComposerChange(current => moveComposerCursorEnd(current));
  }, [applyComposerChange]);

  const submitDraft = useCallback(() => {
    const prompt = normalizeUserInput(composer.text);
    if (!prompt) {
      return;
    }

    setComposer(createComposerState());
    setComposerActivityVersion(current => current + 1);
    void submitPrompt(prompt);
  }, [composer.text, submitPrompt]);

  const visibleMessages = useMemo(() => messages.slice(-VISIBLE_MESSAGE_LIMIT), [messages]);

  const hasConversation = useMemo(
    () => visibleMessages.some(message => message.role !== 'system'),
    [visibleMessages]
  );

  return {
    composer,
    composerActivityVersion,
    visibleMessages,
    hasConversation,
    runState,
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

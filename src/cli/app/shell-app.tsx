import React, {useEffect} from 'react';
import {Box, useApp} from 'ink';
import type {Codara} from '@core';
import {Footer} from '../components/chrome/footer';
import {Header} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {HilPanel} from '../components/conversation/hil-panel';
import {Transcript} from '../components/conversation/transcript';
import {WelcomeState} from '../components/conversation/welcome-state';
import {PromptFrame} from '../components/prompt/prompt-frame';
import type {CliHilAutoAction} from './hil-review';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {useHilInput} from '../hooks/use-hil-input';
import {usePromptInput} from '../hooks/use-prompt-input';
import {useTerminalWidth} from '../hooks/use-terminal-width';

export interface CodaraCliAppProps {
  codara: Codara;
  cwd: string;
  modelAlias: string;
  initialPrompt?: string;
  startupMessage?: string;
  hilAutoActions?: CliHilAutoAction[];
  autoExitOnSettledPrompt?: boolean;
  reopenSession?: (sessionId: string) => Promise<void>;
}

export function CodaraCliApp(props: CodaraCliAppProps): React.JSX.Element {
  const {
    codara,
    cwd,
    initialPrompt,
    modelAlias,
    startupMessage,
    hilAutoActions,
    autoExitOnSettledPrompt = false,
    reopenSession,
  } = props;
  const {exit} = useApp();
  const shell = useCliController({codara, initialPrompt, startupMessage, hilAutoActions, reopenSession});
  const terminalWidth = useTerminalWidth();
  const layoutMode = resolveCliLayoutMode(terminalWidth);
  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasHilReview = Boolean(shell.hilReview);

  // 输入监听挂在组装层；展示组件不直接感知键盘事件。
  usePromptInput({
    interactive: !hasHilReview && !(autoExitOnSettledPrompt && hasInitialPrompt),
    disabled: hasHilReview || shell.runState.status === 'running',
    onInsertText: shell.insertText,
    onInsertNewline: shell.insertNewline,
    onBackspace: shell.backspace,
    onMoveCursorLeft: shell.moveCursorLeft,
    onMoveCursorRight: shell.moveCursorRight,
    onMoveCursorUp: shell.moveCursorUp,
    onMoveCursorDown: shell.moveCursorDown,
    onMoveCursorHome: shell.moveCursorHome,
    onMoveCursorEnd: shell.moveCursorEnd,
    onSubmit: shell.submitDraft,
    onExit: exit,
  });

  useHilInput({
    active: hasHilReview,
    disabled: shell.hilReview?.busy ?? false,
    onMoveLeft: shell.moveHilLeft,
    onMoveRight: shell.moveHilRight,
    onSelectPrevious: shell.selectPreviousHilAction,
    onSelectNext: shell.selectNextHilAction,
    onToggleFocus: shell.toggleHilFocus,
    onInsertText: shell.insertHilText,
    onInsertNewline: shell.insertHilNewline,
    onBackspace: shell.backspaceHilInput,
    onSubmit: shell.submitHilAction,
    onExit: exit,
  });

  useEffect(() => {
    if (
      !autoExitOnSettledPrompt
      || !hasInitialPrompt
      || !shell.hasConversation
      || shell.runState.status === 'running'
      || shell.runState.status === 'paused'
      || shell.hilReview?.busy
    ) {
      return;
    }

    const timer = setTimeout(() => exit(), 50);
    return () => clearTimeout(timer);
  }, [autoExitOnSettledPrompt, exit, hasInitialPrompt, shell.hasConversation, shell.hilReview?.busy, shell.runState.status]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header
        cwd={cwd}
        layoutMode={layoutMode}
        session={shell.sessionState}
        modelAlias={modelAlias}
        runState={shell.runState}
        activeTurn={shell.activeTurn}
        hilBusy={shell.hilReview?.busy}
      />
      {shell.hasConversation ? (
        <Transcript coreMessages={shell.coreMessages} notices={shell.notices} activeTurn={shell.activeTurn} />
      ) : <WelcomeState layoutMode={layoutMode} />}
      <ActivityLine runState={shell.runState} activeTurn={shell.activeTurn} hilBusy={shell.hilReview?.busy} />
      {shell.hilReview ? <HilPanel review={shell.hilReview} /> : null}
      <PromptFrame
        terminalWidth={terminalWidth}
        composer={shell.composer}
        cursorActivityVersion={shell.composerActivityVersion}
        isRunning={shell.runState.status === 'running'}
      />
      <Footer layoutMode={layoutMode} />
    </Box>
  );
}

import React, {useEffect, useRef} from 'react';
import {Box, useApp, useStdout} from 'ink';
import type {Codara} from '@core';
import {Footer} from '../components/chrome/footer';
import {Header} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {HilPanel, isPermissionReview} from '../components/conversation/hil-panel';
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
  openFile?: (targetPath: string) => Promise<boolean>;
}

export type CliForegroundSurface = 'hil' | 'transcript' | 'welcome';

export function resolveCliForegroundSurface(input: {
  hasHilReview: boolean;
  hasConversation: boolean;
}): CliForegroundSurface {
  if (input.hasHilReview) {
    return 'hil';
  }

  return input.hasConversation ? 'transcript' : 'welcome';
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
    openFile,
  } = props;
  const {exit} = useApp();
  const shell = useCliController({codara, initialPrompt, startupMessage, hilAutoActions, reopenSession, openFile});
  const terminalWidth = useTerminalWidth();
  const layoutMode = resolveCliLayoutMode(terminalWidth);
  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasHilReview = Boolean(shell.hilReview);
  const foregroundSurface = resolveCliForegroundSurface({
    hasHilReview,
    hasConversation: shell.hasConversation,
  });

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
    permissionStage: isPermissionReview(shell.hilReview) ? (shell.hilReview?.permissionStage ?? 'prompt') : undefined,
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
    onQuickAction: isPermissionReview(shell.hilReview) ? shell.quickHilAction : undefined,
    onPermissionBack: shell.permissionBack,
    onPermissionConfirm: shell.permissionConfirm,
    onPermissionRejectSend: shell.permissionRejectSend,
    onPermissionRejectSilent: shell.permissionRejectSilent,
  });

  // 从 welcome 切换到 transcript 时清屏，避免布局跳跃残留
  const {stdout} = useStdout();
  const prevSurfaceRef = useRef(foregroundSurface);
  useEffect(() => {
    if (prevSurfaceRef.current === 'welcome' && foregroundSurface !== 'welcome') {
      if (stdout.isTTY) {
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      }
    }
    prevSurfaceRef.current = foregroundSurface;
  }, [foregroundSurface, stdout.isTTY]);

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
      {foregroundSurface === 'welcome' ? (
        <>
          <WelcomeState layoutMode={layoutMode} cwd={cwd} modelAlias={modelAlias} />
          <ActivityLine
            runState={shell.runState}
            activeTurn={shell.activeTurn}
            latestRuntimeEvent={shell.latestRuntimeEvent}
          />
          <PromptFrame
            terminalWidth={terminalWidth}
            composer={shell.composer}
            cursorActivityVersion={shell.composerActivityVersion}
            isRunning={shell.runState.status === 'running'}
          />
          <Footer layoutMode={layoutMode} />
        </>
      ) : (
        <>
          <Header
            layoutMode={layoutMode}
            session={shell.sessionState}
            cwd={cwd}
            modelAlias={modelAlias}
            runState={shell.runState}
            latestRuntimeEvent={shell.latestRuntimeEvent}
          />
          <Transcript
            coreMessages={shell.coreMessages}
            notices={shell.notices}
            activeTurn={shell.activeTurn}
            runtimeEvents={shell.runtimeEvents}
          />
          {foregroundSurface === 'hil' && shell.hilReview ? (
            <HilPanel review={shell.hilReview} />
          ) : (
            <>
              <ActivityLine
                runState={shell.runState}
                activeTurn={shell.activeTurn}
                latestRuntimeEvent={shell.latestRuntimeEvent}
              />
              <PromptFrame
                terminalWidth={terminalWidth}
                composer={shell.composer}
                cursorActivityVersion={shell.composerActivityVersion}
                isRunning={shell.runState.status === 'running'}
              />
              <Footer layoutMode={layoutMode} />
            </>
          )}
        </>
      )}
    </Box>
  );
}

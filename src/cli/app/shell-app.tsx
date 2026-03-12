import React from 'react';
import {Box, useApp} from 'ink';
import {DEFAULT_SESSION_META} from '../adapters/session-meta';
import {Footer} from '../components/footer';
import {Header} from '../components/header';
import {PromptFrame} from '../components/prompt-frame';
import {Transcript} from '../components/transcript';
import {WelcomeState} from '../components/welcome-state';
import {resolveCliLayoutMode} from './layout-mode';
import {usePromptInput} from '../hooks/use-prompt-input';
import {useShellState} from '../hooks/use-shell-state';
import {useTerminalWidth} from '../hooks/use-terminal-width';

export function CodaraCliApp(): React.JSX.Element {
  const {exit} = useApp();
  const shell = useShellState();
  const terminalWidth = useTerminalWidth();
  const layoutMode = resolveCliLayoutMode(terminalWidth);

  // 输入监听挂在组装层；展示组件不直接感知键盘事件。
  usePromptInput({
    disabled: shell.runState.status === 'running',
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

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header cwd={process.cwd()} layoutMode={layoutMode} meta={DEFAULT_SESSION_META} runState={shell.runState} />
      {shell.hasConversation ? <Transcript messages={shell.visibleMessages} /> : <WelcomeState layoutMode={layoutMode} />}
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

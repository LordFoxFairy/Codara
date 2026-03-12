import React from 'react';
import {Box, useApp} from 'ink';
import type {Codara} from '@core';
import {Footer} from '../components/chrome/footer';
import {Header} from '../components/chrome/header';
import {Transcript} from '../components/conversation/transcript';
import {WelcomeState} from '../components/conversation/welcome-state';
import {PromptFrame} from '../components/prompt/prompt-frame';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {usePromptInput} from '../hooks/use-prompt-input';
import {useTerminalWidth} from '../hooks/use-terminal-width';

export interface CodaraCliAppProps {
  codara: Codara;
  cwd: string;
  modelAlias: string;
  initialPrompt?: string;
}

export function CodaraCliApp(props: CodaraCliAppProps): React.JSX.Element {
  const {codara, cwd, initialPrompt, modelAlias} = props;
  const {exit} = useApp();
  const shell = useCliController({codara, initialPrompt});
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
      <Header
        cwd={cwd}
        layoutMode={layoutMode}
        session={shell.sessionState}
        modelAlias={modelAlias}
        runState={shell.runState}
      />
      {shell.hasConversation ? (
        <Transcript coreMessages={shell.coreMessages} notices={shell.notices} activeTurn={shell.activeTurn} />
      ) : <WelcomeState layoutMode={layoutMode} />}
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

import React, {useCallback, useEffect, useState} from 'react';
import {Box, Static, useApp} from 'ink';
import type {Codara} from '@/index';
import {CommandOutputPanel} from '../components/chrome/command-output-panel';
import {Footer} from '../components/chrome/footer';
import {StatusBar} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {TaskPanel} from '../components/chrome/task-panel';
import {HilPanel, isPermissionReview} from '../components/conversation/hil-panel';
import {SessionPicker} from '../components/conversation/session-picker';
import {ActiveTranscript} from '../components/conversation/transcript';
import {SolidifiedBlock} from '../components/conversation/solidified-block';
import {TIPS} from '../hooks/use-rotating-tip';
import {CompletionMenu} from '../components/prompt/completion-menu';
import {PromptFrame} from '../components/prompt/prompt-frame';
import type {CliHilAutoAction} from './hil-review';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {useActiveTasks} from '../hooks/use-active-tasks';
import {useCommandCompletion} from '../hooks/use-command-completion';
import {useHilInput} from '../hooks/use-hil-input';
import {usePromptInput} from '../hooks/use-prompt-input';
import {useSessionPicker} from '../hooks/use-session-picker';
import {useSolidifiedTranscript} from '../hooks/use-solidified-transcript';
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

  // Session picker for /resume without args
  const listSessionsForPicker = useCallback(
    () => codara.listSessions({sortBy: 'lastActivity', sortOrder: 'desc', limit: 10}),
    [codara],
  );
  const handleSessionPickerSelect = useCallback(
    (sessionId: string) => {
      if (reopenSession) {
        void reopenSession(sessionId);
      }
    },
    [reopenSession],
  );
  const sessionPicker = useSessionPicker({
    listSessions: listSessionsForPicker,
    onSelect: handleSessionPickerSelect,
    onCancel: () => {},
  });

  const shell = useCliController({
    codara,
    initialPrompt,
    startupMessage,
    hilAutoActions,
    reopenSession,
    openFile,
    onShowSessionPicker: sessionPicker.show,
  });
  const terminalWidth = useTerminalWidth();
  const layoutMode = resolveCliLayoutMode(terminalWidth);
  const activeTasks = useActiveTasks({runtimeEvents: shell.runtimeEvents});
  const listCommands = React.useCallback(() => codara.listCommands(), [codara]);
  const completion = useCommandCompletion({
    text: shell.composer.text,
    disabled: shell.runState.status === 'running',
    listCommands,
  });
  const mcpStatus = React.useMemo(() => {
    const statuses = codara.getMcpStatus();
    if (statuses.length === 0) return undefined;
    return {
      connected: statuses.filter((s) => s.status === 'connected').length,
      total: statuses.length,
    };
  }, [codara]);
  // Freeze tip and initial terminal width at mount time (for Static welcome)
  const [frozenTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]!);

  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasHilReview = Boolean(shell.hilReview);
  const foregroundSurface = resolveCliForegroundSurface({
    hasHilReview,
    hasConversation: shell.hasConversation,
  });

  // 输入监听挂在组装层；展示组件不直接感知键盘事件。
  usePromptInput({
    interactive: !hasHilReview && !sessionPicker.state.visible && !(autoExitOnSettledPrompt && hasInitialPrompt),
    disabled: hasHilReview || sessionPicker.state.visible || shell.runState.status === 'running',
    onInsertText: shell.insertText,
    onInsertNewline: shell.insertNewline,
    onBackspace: shell.backspace,
    onMoveCursorLeft: shell.moveCursorLeft,
    onMoveCursorRight: shell.moveCursorRight,
    onMoveCursorUp: () => {
      if (shell.commandOutput && !shell.composer.text.trim()) { shell.scrollCommandOutput(-1); return; }
      if (completion.completion.visible) { completion.moveUp(); return; }
      shell.moveCursorUp();
    },
    onMoveCursorDown: () => {
      if (shell.commandOutput && !shell.composer.text.trim()) { shell.scrollCommandOutput(1); return; }
      if (completion.completion.visible) { completion.moveDown(); return; }
      shell.moveCursorDown();
    },
    onMoveCursorHome: shell.moveCursorHome,
    onMoveCursorEnd: shell.moveCursorEnd,
    onSubmit: () => {
      if (completion.completion.visible) {
        const accepted = completion.accept();
        completion.dismiss();
        if (accepted) {
          // Use submitText to bypass stale closure on composer.text
          shell.submitText(accepted);
        }
        return;
      }
      shell.submitDraft();
    },
    onExit: () => {
      if (completion.completion.visible) { completion.dismiss(); return; }
      if (shell.commandOutput) { shell.dismissCommandOutput(); return; }
      exit();
    },
    onToggleTaskPanel: shell.toggleTaskPanel,
    onToggleExpand: shell.toggleExpand,
    onTab: () => {
      if (completion.completion.visible) {
        const accepted = completion.accept();
        if (accepted) shell.replaceText(accepted);
        completion.dismiss();
        return;
      }
    },
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

  const {solidifiedItems, activeItems} = useSolidifiedTranscript({
    coreMessages: shell.coreMessages,
    notices: shell.notices,
    activeTurn: shell.activeTurn,
    runtimeEvents: shell.runtimeEvents,
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
      <Box flexDirection="column" paddingX={1}>
        {/* 固化区：渲染一次，永久留在滚动缓冲区 */}
        <Static items={solidifiedItems}>
          {(turn) => (
            <SolidifiedBlock
              key={turn.id}
              turn={turn}
              layoutMode={layoutMode}
              cwd={cwd}
              modelAlias={modelAlias}
              tip={frozenTip}
            />
          )}
        </Static>

        {/* 动态区 */}
        {activeItems.length > 0 && <ActiveTranscript items={activeItems} expandedAll={shell.expandedAll} />}

        {/* Task Panel — ActiveTranscript 和 ActivityLine 之间 */}
        {shell.hasConversation && activeTasks.hasActiveTasks && shell.taskPanelVisible && foregroundSurface !== 'hil' && (
          <TaskPanel
            tasks={activeTasks.tasks}
            runningCount={activeTasks.runningCount}
            doneCount={activeTasks.doneCount}
            errorCount={activeTasks.errorCount}
          />
        )}

        {/* HIL 或正常交互区 — 始终渲染 */}
        {foregroundSurface === 'hil' && shell.hilReview ? (
          <HilPanel review={shell.hilReview} />
        ) : (
          <>
            <ActivityLine
              runState={shell.runState}
              activeTurn={shell.activeTurn}
              latestRuntimeEvent={shell.latestRuntimeEvent}
              sessionMetadata={shell.sessionState.metadata}
            />
            {sessionPicker.state.visible && (
              <SessionPicker
                sessions={sessionPicker.state.sessions}
                loading={sessionPicker.state.loading}
                selectedIndex={sessionPicker.state.selectedIndex}
                onMoveUp={sessionPicker.moveUp}
                onMoveDown={sessionPicker.moveDown}
                onSelect={sessionPicker.select}
                onCancel={sessionPicker.hide}
              />
            )}
            {shell.commandOutput && (
              <CommandOutputPanel content={shell.commandOutput.content} commandName={shell.commandOutput.commandName} scrollOffset={shell.commandOutput.scrollOffset} />
            )}
            {!shell.commandOutput && !completion.completion.visible && (
              <PromptFrame
                composer={shell.composer}
                cursorActivityVersion={shell.composerActivityVersion}
                isRunning={shell.runState.status === 'running'}
                placeholder={shell.hasConversation ? 'Reply to Codara...' : 'Ask Codara...'}
              />
            )}
            <CompletionMenu completion={completion.completion} />
            {shell.hasConversation && (
              <StatusBar
                layoutMode={layoutMode}
                session={shell.sessionState}
                cwd={cwd}
                modelAlias={modelAlias}
                runState={shell.runState}
                latestRuntimeEvent={shell.latestRuntimeEvent}
                mcpStatus={mcpStatus}
              />
            )}
            <Footer layoutMode={layoutMode} hasCommandOutput={Boolean(shell.commandOutput)} />
          </>
        )}
      </Box>
  );
}

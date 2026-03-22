import React, {useCallback, useEffect, useState} from 'react';
import {Box, Static, useApp} from 'ink';
import type {Codara, CodaraRuntimeEvent} from '@/index';
import {CommandOutputPanel} from '../components/chrome/command-output-panel';
import {Footer} from '../components/chrome/footer';
import {StatusBar} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {TaskPanel} from '../components/chrome/task-panel';
import {ReviewPanel, isPermissionReview} from '../components/conversation/review-panel';
import {SessionPicker} from '../components/conversation/session-picker';
import {ActiveTranscript} from '../components/conversation/transcript';
import {SolidifiedBlock} from '../components/conversation/solidified-block';
import {TIPS} from '../hooks/use-rotating-tip';
import {CompletionMenu} from '../components/prompt/completion-menu';
import {PromptFrame} from '../components/prompt/prompt-frame';
import type {CliReviewAutoAction} from './review-state';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {useActiveTasks} from '../hooks/use-active-tasks';
import {useCommandCompletion} from '../hooks/use-command-completion';
import {useCliInteractionInput} from '../hooks/use-cli-interaction-input';
import {useSessionPicker} from '../hooks/use-session-picker';
import {useSolidifiedTranscript} from '../hooks/use-solidified-transcript';
import {useTerminalWidth} from '../hooks/use-terminal-width';
import type {CliInteractionSurface, CliReviewState} from './view-state';
import {shouldSpaceInsertIntoCliReviewDraft} from './review-state';
import type {TranscriptItem} from '../transcript/model';

export interface CodaraCliAppProps {
  codara: Codara;
  cwd: string;
  modelAlias: string;
  initialPrompt?: string;
  startupMessage?: string;
  reviewAutoActions?: CliReviewAutoAction[];
  autoExitOnSettledPrompt?: boolean;
  reopenSession?: (sessionId: string) => Promise<void>;
  openFile?: (targetPath: string) => Promise<boolean>;
}

export type CliForegroundSurface = 'transcript' | 'welcome';

export function resolveCliForegroundSurface(input: {
  hasReview: boolean;
  hasConversation: boolean;
}): CliForegroundSurface {
  if (input.hasConversation || input.hasReview) {
    return 'transcript';
  }
  return 'welcome';
}

export function isFloatingReview(review: CliReviewState | undefined): boolean {
  return Boolean(review);
}

export function shouldShowPromptFrame(input: {
  review?: CliReviewState;
  hasCommandOutput: boolean;
  hasCompletion: boolean;
  hasSessionPicker: boolean;
}): boolean {
  if (input.hasCommandOutput || input.hasCompletion || input.hasSessionPicker) {
    return false;
  }

  return input.review?.blockingScope !== 'session';
}

export function shouldDisablePromptInput(input: {
  review?: CliReviewState;
  focusedSurface: CliInteractionSurface;
  hasSessionPicker: boolean;
}): boolean {
  return input.review?.blockingScope === 'session'
    || input.focusedSurface !== 'prompt'
    || input.hasSessionPicker;
}

export function resolveActiveInteractionSurface(input: {
  focusedSurface: CliInteractionSurface;
  hasCommandOutput: boolean;
  hasCompletion: boolean;
  hasSessionPicker: boolean;
}): CliInteractionSurface {
  if (input.hasSessionPicker) {
    return 'session-picker';
  }
  if (input.hasCommandOutput) {
    return 'command-output';
  }
  if (input.hasCompletion) {
    return 'completion';
  }
  return input.focusedSurface;
}

export function shouldShowTaskPanel(input: {
  taskPanelVisible: boolean;
  taskCount: number;
}): boolean {
  return input.taskPanelVisible && input.taskCount > 1;
}

export function shouldShowFloatingTaskPanel(input: {
  hasConversation: boolean;
  taskPanelVisible: boolean;
  taskCount: number;
  hasBlockingOverlay: boolean;
}): boolean {
  if (input.hasBlockingOverlay || !input.hasConversation) {
    return false;
  }

  return shouldShowTaskPanel({
    taskPanelVisible: input.taskPanelVisible,
    taskCount: input.taskCount,
  });
}

export function shouldShowActivityLine(input: {
  review?: CliReviewState;
  runStateStatus: 'idle' | 'running' | 'paused' | 'done' | 'error';
  latestRuntimeEventKind?: CodaraRuntimeEvent['kind'];
  activeItems: readonly TranscriptItem[];
  activeTaskCount?: number;
  pausedTaskCount?: number;
}): boolean {
  if (input.review) {
    return false;
  }

  if (input.runStateStatus !== 'running') {
    return true;
  }

  const transcriptOwnsTaskExecution = input.activeItems.some((item) => (
    item.role === 'task' && item.toolMeta?.status === 'running'
  ));

  if (!transcriptOwnsTaskExecution) {
    return (input.activeTaskCount ?? 0) === 0
      && (input.pausedTaskCount ?? 0) === 0;
  }

  return input.latestRuntimeEventKind !== 'agent' && input.latestRuntimeEventKind !== 'tool';
}

export function CodaraCliApp(props: CodaraCliAppProps): React.JSX.Element {
  const {
    codara,
    cwd,
    initialPrompt,
    modelAlias,
    startupMessage,
    reviewAutoActions,
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
    reviewAutoActions,
    reopenSession,
    openFile,
    onShowSessionPicker: sessionPicker.show,
  });
  const terminalWidth = useTerminalWidth();
  const layoutMode = resolveCliLayoutMode(terminalWidth);
  const activeTasks = useActiveTasks({
    agentRunSummaries: codara.getAgentRunSummaries(),
    reviews: codara.listReviewItems(),
  });
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
  const hasReview = Boolean(shell.review);
  const floatingReview = isFloatingReview(shell.review) ? shell.review : undefined;
  const hasBlockingOverlay = Boolean(
    shell.commandOutput
    || completion.completion.visible
    || sessionPicker.state.visible
  );
  const showPromptFrame = shouldShowPromptFrame({
    review: shell.review,
    hasCommandOutput: Boolean(shell.commandOutput),
    hasCompletion: completion.completion.visible,
    hasSessionPicker: sessionPicker.state.visible,
  });
  const activeSurface = resolveActiveInteractionSurface({
    focusedSurface: shell.interactionState.focusedSurface,
    hasCommandOutput: Boolean(shell.commandOutput),
    hasCompletion: completion.completion.visible,
    hasSessionPicker: sessionPicker.state.visible,
  });
  const promptInputDisabled = shouldDisablePromptInput({
    review: shell.review,
    focusedSurface: shell.interactionState.focusedSurface,
    hasSessionPicker: sessionPicker.state.visible,
  });
  useCliInteractionInput({
    activeSurface,
    interactive: !(autoExitOnSettledPrompt && hasInitialPrompt),
    reviewDisabled: shell.review?.busy ?? false,
    reviewSpaceInsertsText: shouldSpaceInsertIntoCliReviewDraft(shell.review),
    reviewPermissionStage: isPermissionReview(shell.review) ? (shell.review?.permissionStage ?? 'prompt') : undefined,
    onPromptInsertText: shell.insertText,
    onPromptInsertNewline: shell.insertNewline,
    onPromptBackspace: shell.backspace,
    onPromptMoveCursorLeft: shell.moveCursorLeft,
    onPromptMoveCursorRight: shell.moveCursorRight,
    onPromptMoveCursorUp: shell.moveCursorUp,
    onPromptMoveCursorDown: shell.moveCursorDown,
    onPromptMoveCursorHome: shell.moveCursorHome,
    onPromptMoveCursorEnd: shell.moveCursorEnd,
    onPromptSubmit: shell.submitDraft,
    onExit: () => {
      if (activeSurface === 'completion') { completion.dismiss(); return; }
      if (activeSurface === 'command-output') { shell.dismissCommandOutput(); return; }
      if (activeSurface === 'session-picker') { sessionPicker.hide(); return; }
      exit();
    },
    onToggleTaskPanel: shell.toggleTaskPanel,
    onToggleExpand: shell.toggleExpand,
    onFocusReview: hasReview ? shell.focusReviewWindow : undefined,
    onReviewMoveLeft: shell.moveReviewLeft,
    onReviewMoveRight: shell.moveReviewRight,
    onReviewSelectPrevious: shell.selectPreviousReviewAction,
    onReviewSelectNext: shell.selectNextReviewAction,
    onReviewSelectPreviousReview: shell.selectPreviousReview,
    onReviewSelectNextReview: shell.selectNextReview,
    onReviewToggleFocus: shell.toggleReviewFocus,
    onReviewActivateSelection: shell.activateReviewSelection,
    onReviewInsertText: shell.insertReviewText,
    onReviewInsertNewline: shell.insertReviewNewline,
    onReviewBackspace: shell.backspaceReviewInput,
    onReviewSubmit: shell.submitReviewAction,
    onReviewQuickAction: isPermissionReview(shell.review) ? shell.quickReviewAction : undefined,
    onFocusPrompt: shell.focusPromptWindow,
    onPermissionBack: shell.permissionBack,
    onPermissionConfirm: shell.permissionConfirm,
    onPermissionRejectSend: shell.permissionRejectSend,
    onPermissionRejectSilent: shell.permissionRejectSilent,
    onCompletionMoveUp: completion.moveUp,
    onCompletionMoveDown: completion.moveDown,
    onCompletionAcceptSubmit: () => {
      const accepted = completion.accept();
      completion.dismiss();
      if (accepted) {
        shell.submitText(accepted);
      }
    },
    onCompletionAcceptReplace: () => {
      const accepted = completion.accept();
      if (accepted) {
        shell.replaceText(accepted);
      }
      completion.dismiss();
    },
    onCompletionDismiss: completion.dismiss,
    onCommandOutputScroll: shell.scrollCommandOutput,
    onCommandOutputClose: shell.dismissCommandOutput,
    onSessionPickerMoveUp: sessionPicker.moveUp,
    onSessionPickerMoveDown: sessionPicker.moveDown,
    onSessionPickerSelect: sessionPicker.select,
    onSessionPickerCancel: sessionPicker.hide,
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
      || shell.review?.busy
    ) {
      return;
    }

    const timer = setTimeout(() => exit(), 50);
    return () => clearTimeout(timer);
  }, [autoExitOnSettledPrompt, exit, hasInitialPrompt, shell.hasConversation, shell.review?.busy, shell.runState.status]);

  return (
      <Box flexDirection="column" paddingX={1}>
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
        {activeItems.length > 0 && <ActiveTranscript items={activeItems} activeTasks={activeTasks.tasks} expandedAll={shell.expandedAll} />}

        {/* Activity / Prompt / Status */}
        <>
            {shouldShowActivityLine({
              review: shell.review,
              runStateStatus: shell.runState.status,
              latestRuntimeEventKind: shell.latestRuntimeEvent?.kind,
              activeItems,
              activeTaskCount: activeTasks.runningCount,
              pausedTaskCount: activeTasks.pausedCount,
            }) && (
              <ActivityLine
                runState={shell.runState}
                activeTurn={shell.activeTurn}
                latestRuntimeEvent={shell.latestRuntimeEvent}
                sessionMetadata={shell.sessionState.metadata}
              />
            )}
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
            {shouldShowFloatingTaskPanel({
              hasConversation: shell.hasConversation,
              taskPanelVisible: shell.taskPanelVisible,
              taskCount: activeTasks.tasks.length,
              hasBlockingOverlay,
            }) && (
              <Box marginTop={1}>
                <TaskPanel
                  tasks={activeTasks.tasks}
                  runningCount={activeTasks.runningCount}
                  pausedCount={activeTasks.pausedCount}
                  doneCount={activeTasks.doneCount}
                  errorCount={activeTasks.errorCount}
                />
              </Box>
            )}
            {showPromptFrame && (
              <Box>
                <Box flexGrow={1}>
                  <PromptFrame
                    composer={shell.composer}
                    cursorActivityVersion={shell.composerActivityVersion}
                    isRunning={promptInputDisabled}
                    placeholder={shell.hasConversation ? 'Reply to Codara...' : 'Ask Codara...'}
                    terminalWidth={terminalWidth}
                  />
                </Box>
              </Box>
            )}
            {floatingReview && !shell.commandOutput && !completion.completion.visible && !sessionPicker.state.visible && (
              <Box marginTop={1}>
                <ReviewPanel review={floatingReview} terminalWidth={terminalWidth} />
              </Box>
            )}
            <CompletionMenu completion={completion.completion} terminalWidth={terminalWidth} />
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
            <Footer
              layoutMode={layoutMode}
              hasCommandOutput={Boolean(shell.commandOutput)}
              focusedSurface={activeSurface}
            />
        </>
      </Box>
  );
}

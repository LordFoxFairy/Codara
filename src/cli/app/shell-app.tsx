import React, {useCallback, useEffect, useState} from 'react';
import {Box, Static, Text, useApp} from 'ink';
import type {Codara} from '@/index';
import {CommandOutputPanel} from '../components/chrome/command-output-panel';
import {Footer} from '../components/chrome/footer';
import {StatusBar} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {TaskPanel} from '../components/chrome/task-panel';
import {TeamPanel} from '../components/chrome/team-panel';
import {TeamDetailView} from '../components/teams/team-detail-view';
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
import {useActiveTeams} from '../hooks/use-active-teams';
import {useCommandCompletion} from '../hooks/use-command-completion';
import {useHilInput} from '../hooks/use-hil-input';
import {usePromptInput} from '../hooks/use-prompt-input';
import {useSessionPicker} from '../hooks/use-session-picker';
import {useSolidifiedTranscript} from '../hooks/use-solidified-transcript';
import {useTerminalWidth} from '../hooks/use-terminal-width';
import type {CliHilReviewState} from './view-state';
import type {TranscriptItem} from '../transcript/model';

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

export function isFloatingHilReview(review: CliHilReviewState | undefined): boolean {
  return Boolean(review);
}

export function shouldShowPromptFrame(input: {
  hilReview?: CliHilReviewState;
  hasCommandOutput: boolean;
  hasCompletion: boolean;
  hasSessionPicker: boolean;
}): boolean {
  if (input.hasCommandOutput || input.hasCompletion || input.hasSessionPicker) {
    return false;
  }

  return !input.hilReview;
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
  hilReview?: CliHilReviewState;
  runStateStatus: 'idle' | 'running' | 'paused' | 'done' | 'error';
  latestRuntimeEventKind?: CodaraRuntimeEvent['kind'];
  activeItems: readonly TranscriptItem[];
  activeTaskCount?: number;
  pausedTaskCount?: number;
}): boolean {
  if (input.hilReview) {
    return false;
  }

  if (input.runStateStatus !== 'running') {
    return true;
  }

  const transcriptOwnsTaskExecution = input.activeItems.some((item) => (
    item.role === 'task' && item.toolMeta?.status === 'running'
  ));

  if (!transcriptOwnsTaskExecution) {
    return (input.activeTaskCount ?? 0) === 0 && (input.pausedTaskCount ?? 0) === 0;
  }

  return input.latestRuntimeEventKind !== 'task' && input.latestRuntimeEventKind !== 'tool';
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
  const activeTasks = useActiveTasks({
    taskRunSummaries: codara.getTaskRunSummaries(),
    approvals: codara.getApprovalSummaries(),
  });
  const activeTeams = useActiveTeams({
    teamSummaries: codara.getTeamSummaries(),
    runtimeEvents: shell.runtimeEvents,
  });

  const teamMembers = React.useMemo(() => {
    if (!activeTeams.hasActiveTeams) return undefined;
    const map = new Map<string, Array<{name: string; role: string; status: string; currentJobId?: string; activity?: string}>>();
    for (const team of activeTeams.activeTeams) {
      const detail = codara.getTeamDetail(team.teamId);
      if (detail && detail.members.length > 0) {
        map.set(team.teamId, detail.members.map(m => ({
          name: m.name,
          role: m.role,
          status: m.status,
          currentJobId: m.currentJobId,
          activity: activeTeams.memberActivities.get(m.memberId),
        })));
      }
    }
    return map.size > 0 ? map : undefined;
  }, [activeTeams.activeTeams, activeTeams.hasActiveTeams, activeTeams.memberActivities, codara]);
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
  // Team member selection (shift+↑/↓)
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(-1);
  const allTeamMembers = React.useMemo(() => {
    if (!teamMembers) return [];
    const members: Array<{teamId: string; name: string; role: string}> = [];
    for (const [teamId, ms] of teamMembers) {
      for (const m of ms) {
        members.push({teamId, name: m.name, role: m.role});
      }
    }
    return members;
  }, [teamMembers]);
  const selectedMemberName = selectedMemberIndex >= 0 && selectedMemberIndex < allTeamMembers.length
    ? allTeamMembers[selectedMemberIndex]?.name
    : undefined;
  const handleSelectMemberUp = useCallback(() => {
    if (allTeamMembers.length === 0) return;
    setSelectedMemberIndex((prev) => prev <= 0 ? allTeamMembers.length - 1 : prev - 1);
  }, [allTeamMembers.length]);
  const handleSelectMemberDown = useCallback(() => {
    if (allTeamMembers.length === 0) return;
    setSelectedMemberIndex((prev) => prev >= allTeamMembers.length - 1 ? 0 : prev + 1);
  }, [allTeamMembers.length]);

  // Freeze tip and initial terminal width at mount time (for Static welcome)
  const [frozenTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]!);

  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasHilReview = Boolean(shell.hilReview);
  const floatingHilReview = isFloatingHilReview(shell.hilReview) ? shell.hilReview : undefined;
  const hasBlockingOverlay = Boolean(
    shell.commandOutput
    || completion.completion.visible
    || sessionPicker.state.visible
  );
  const showPromptFrame = shouldShowPromptFrame({
    hilReview: shell.hilReview,
    hasCommandOutput: Boolean(shell.commandOutput),
    hasCompletion: completion.completion.visible,
    hasSessionPicker: sessionPicker.state.visible,
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
    onSelectMemberUp: handleSelectMemberUp,
    onSelectMemberDown: handleSelectMemberDown,
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
    onSelectPreviousApproval: shell.selectPreviousApproval,
    onSelectNextApproval: shell.selectNextApproval,
    onToggleFocus: shell.toggleHilFocus,
    onActivateSelection: shell.activateHilSelection,
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
        {activeItems.length > 0 && <ActiveTranscript items={activeItems} activeTasks={activeTasks.tasks} expandedAll={shell.expandedAll} />}

        {/* Activity / Prompt / Status — 始终渲染 */}
        <>
            {shouldShowActivityLine({
              hilReview: shell.hilReview,
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
            {shell.hasConversation && shell.taskPanelVisible && !hasBlockingOverlay && activeTeams.hasActiveTeams && (
              <Box marginTop={1}>
                {shell.teamDetailState ? (
                  <TeamDetailView state={shell.teamDetailState} />
                ) : (
                  <TeamPanel
                    teams={activeTeams.activeTeams}
                    runningCount={activeTeams.runningCount}
                    doneCount={activeTeams.doneCount}
                    errorCount={activeTeams.errorCount}
                    teamMembers={teamMembers}
                  />
                )}
              </Box>
            )}
            {showPromptFrame && (
              <Box>
                <Box flexGrow={1}>
                  <PromptFrame
                    composer={shell.composer}
                    cursorActivityVersion={shell.composerActivityVersion}
                    isRunning={shell.runState.status === 'running'}
                    placeholder={shell.hasConversation ? 'Reply to Codara...' : 'Ask Codara...'}
                    terminalWidth={terminalWidth}
                  />
                </Box>
                {selectedMemberName && activeTeams.hasActiveTeams && (
                  <Box>
                    <Text color="green" bold>@{selectedMemberName}</Text>
                  </Box>
                )}
              </Box>
            )}
            {floatingHilReview && !shell.commandOutput && !completion.completion.visible && !sessionPicker.state.visible && (
              <Box marginTop={1}>
                <HilPanel review={floatingHilReview} presentation="floating" />
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
                activeTeamCount={activeTeams.runningCount > 0 ? activeTeams.runningCount : undefined}
              />
            )}
            <Footer layoutMode={layoutMode} hasCommandOutput={Boolean(shell.commandOutput)} hasActiveTeams={activeTeams.runningCount > 0} />
        </>
      </Box>
  );
}

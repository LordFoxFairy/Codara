import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Static, Text, useApp} from 'ink';
import type {Codara} from '@/index';
import {CommandOutputPanel} from '../components/chrome/command-output-panel';
import {Footer} from '../components/chrome/footer';
import {StatusBar} from '../components/chrome/header';
import {ActivityLine} from '../components/chrome/activity-line';
import {TaskPanel} from '../components/chrome/task-panel';
import {TeamPanel} from '../components/chrome/team-panel';
import {HilPanel, isPermissionReview} from '../components/conversation/hil-panel';
import {SessionPicker} from '../components/conversation/session-picker';
import {ActiveTranscript} from '../components/conversation/transcript';
import {SolidifiedBlock} from '../components/conversation/solidified-block';
import {TIPS} from '../hooks/use-rotating-tip';
import {CompletionMenu} from '../components/prompt/completion-menu';
import {PromptFrame} from '../components/prompt/prompt-frame';
import {useCliPromptSurface} from '../hooks/use-cli-prompt-surface';
import type {CliHilAutoAction} from './hil-review';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {useActiveTasks} from '../hooks/use-active-tasks';
import {useActiveTeams} from '../hooks/use-active-teams';
import {useHilInput} from '../hooks/use-hil-input';
import {useSessionPicker} from '../hooks/use-session-picker';
import {useSolidifiedTranscript} from '../hooks/use-solidified-transcript';
import {useTerminalWidth} from '../hooks/use-terminal-width';
import {useTeamPanelState} from '../hooks/use-team-panel-state';

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

  // /resume 不带参数时，会走这里弹会话选择器。
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
  const taskRunSummaries = codara.getTaskRunSummaries();
  const approvals = codara.getApprovalSummaries();
  const teamSummaries = codara.getTeamSummaries();
  const activeTasks = useActiveTasks({taskRunSummaries, approvals});
  const activeTeams = useActiveTeams({teamSummaries, runtimeEvents: shell.runtimeEvents});
  const teamPanelState = useTeamPanelState({codara, activeTeams});
  const mcpStatus = useMemo(() => {
    const statuses = codara.getMcpStatus();
    if (statuses.length === 0) return undefined;
    return {
      connected: statuses.filter((s) => s.status === 'connected').length,
      total: statuses.length,
    };
  }, [codara]);

  // 这行只做一件事：把欢迎语固定住，别每次重渲染都换一句。
  const [frozenTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]!);

  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasHilReview = Boolean(shell.hilReview);
  const promptSurface = useCliPromptSurface({
    codara,
    composer: shell.composer,
    hasDraftContent: shell.hasDraftContent,
    hasConversation: shell.hasConversation,
    hasHilReview,
    sessionPickerVisible: sessionPicker.state.visible,
    autoExitOnSettledPrompt,
    hasInitialPrompt,
    runStatus: shell.runState.status,
    hasCommandOutput: Boolean(shell.commandOutput),
    hasActiveTeams: activeTeams.hasActiveTeams,
    selectedMemberName: teamPanelState.selectedMember?.name,
    exit,
    dismissCommandOutput: shell.dismissCommandOutput,
    scrollCommandOutput: shell.scrollCommandOutput,
    insertText: shell.insertText,
    insertNewline: shell.insertNewline,
    backspace: shell.backspace,
    moveCursorLeft: shell.moveCursorLeft,
    moveCursorRight: shell.moveCursorRight,
    moveCursorUp: shell.moveCursorUp,
    moveCursorDown: shell.moveCursorDown,
    moveCursorHome: shell.moveCursorHome,
    moveCursorEnd: shell.moveCursorEnd,
    isBrowsingHistory: shell.isBrowsingHistory,
    recallPreviousHistory: shell.recallPreviousHistory,
    recallNextHistory: shell.recallNextHistory,
    submitDraft: shell.submitDraft,
    replaceText: shell.replaceText,
    toggleTaskPanel: shell.toggleTaskPanel,
    toggleExpand: shell.toggleExpand,
    selectPreviousMember: teamPanelState.selectPreviousMember,
    selectNextMember: teamPanelState.selectNextMember,
    terminalWidth,
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

      {/* 统一任务/团队面板，Ctrl+T 切换 */}
      {shell.hasConversation && shell.taskPanelVisible && (
        <>
          {activeTasks.hasActiveTasks && (
            <TaskPanel
              tasks={activeTasks.tasks}
              runningCount={activeTasks.runningCount}
              pausedCount={activeTasks.pausedCount}
              doneCount={activeTasks.doneCount}
              errorCount={activeTasks.errorCount}
            />
          )}
          {activeTeams.hasActiveTeams && (
            <TeamPanel
              teams={teamPanelState.teams}
              runningCount={activeTeams.runningCount}
              doneCount={activeTeams.doneCount}
              errorCount={activeTeams.errorCount}
              teamMembers={teamPanelState.teamMembers}
            />
          )}
        </>
      )}

      {/* HIL 内联显示在对话流下方，不替换整个界面 */}
      {shell.hilReview && <HilPanel review={shell.hilReview} />}

      <>
        {!shell.hilReview && (
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
        {promptSurface.showCommandOutput && shell.commandOutput && (
          <CommandOutputPanel
            content={shell.commandOutput.content}
            commandName={shell.commandOutput.commandName}
            scrollOffset={shell.commandOutput.scrollOffset}
          />
        )}
        {promptSurface.showPromptFrame && (
          <Box flexDirection="column">
            <Box flexGrow={1}>
              <PromptFrame
                composer={shell.composer}
                hasDraftContent={shell.hasDraftContent}
                collapsedPasteSummary={shell.collapsedPasteSummary}
                cursorActivityVersion={shell.composerActivityVersion}
                isRunning={shell.runState.status === 'running'}
                placeholder={promptSurface.promptPlaceholder}
                terminalWidth={terminalWidth}
              />
            </Box>
            <Box paddingLeft={2}>
              <CompletionMenu completion={promptSurface.completion} />
            </Box>
            {promptSurface.showSelectedMember && promptSurface.selectedMemberName && (
              <Box>
                <Text color="green" bold>@{promptSurface.selectedMemberName}</Text>
              </Box>
            )}
          </Box>
        )}
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
        <Footer
          layoutMode={layoutMode}
          hasCommandOutput={promptSurface.showCommandOutput}
          hasActiveTeams={activeTeams.runningCount > 0}
        />
      </>
    </Box>
  );
}

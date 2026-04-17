/**
 * Shell application -- the root Ink component for the interactive CLI.
 *
 * Composes the CLI controller, command-completion, session picker, and
 * subagent data sources, computes the visibility flags, wires every
 * callback through `useCliInteractionInput`, and delegates rendering to
 * `ShellLayout`. Pure predicates live in `shell-predicates.ts`; input
 * binding lives in `shell-input-bindings.ts`; layout lives in
 * `shell-layout.tsx`.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {useApp} from 'ink';
import type {Codara} from '@/index';
import {TIPS} from '../hooks/use-rotating-tip';
import type {CliReviewAutoAction} from '../features/review/state-core';
import {resolveCliLayoutMode} from './layout-mode';
import {useCliController} from './use-cli-controller';
import {useSubagentRuns} from '../features/subagent/use-runs';
import {useSubagentRunDetails} from '../features/subagent/use-run-details';
import {useCommandCompletion} from '../features/composer/use-completion';
import {useCliInteractionInput} from '../hooks/use-cli-interaction-input';
import {useSessionPicker} from '../features/session/use-picker';
import {useSolidifiedTranscript} from '../features/transcript/use-solidify';
import {useTerminalWidth} from '../hooks/use-terminal-width';
import {
  isFloatingReview,
  resolveActiveInteractionSurface,
  shouldDisablePromptInput,
  shouldShowPromptFrame,
} from './shell-predicates';
import {buildShellInputBindings} from './shell-input-bindings';
import {ShellLayout} from './shell-layout';

// Re-export predicates so existing consumers (e.g. unit tests) that import
// them from shell-app continue to work unchanged.
export {
  resolveCliForegroundSurface,
  isFloatingReview,
  shouldShowPromptFrame,
  shouldDisablePromptInput,
  resolveActiveInteractionSurface,
  shouldShowSubagentRunPanel,
  shouldShowFloatingSubagentRunPanel,
  hasVisibleAssistantSolidifiedReply,
  type CliForegroundSurface,
} from './shell-predicates';

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
  const subagentRunSummaries = codara.getSubagentRunSummaries();
  const subagentRuns = useSubagentRuns({
    subagentRunSummaries,
    reviews: codara.listReviewItems(),
  });
  const subagentRunDetails = useSubagentRunDetails({
    codara,
    runs: subagentRunSummaries,
    enabled: shell.expandedAll,
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
    hasCompletion: completion.completion.visible,
    hasCommandOutput: Boolean(shell.commandOutput),
    runStateStatus: shell.runState.status,
  });

  useCliInteractionInput(buildShellInputBindings({
    shell,
    completion,
    sessionPicker,
    activeSurface,
    promptInputDisabled,
    hasReview,
    interactive: !(autoExitOnSettledPrompt && hasInitialPrompt),
    onExit: exit,
  }));

  const {solidifiedItems, activeItems} = useSolidifiedTranscript({
    coreMessages: shell.coreMessages,
    notices: shell.notices,
    activeTurn: shell.activeTurn,
    runtimeEvents: shell.runtimeEvents,
    runState: shell.runState,
    subagentRuns: subagentRunSummaries,
  });
  const showPromptFrame = shouldShowPromptFrame({
    review: shell.review,
    focusedSurface: shell.interactionState.focusedSurface,
    hasCommandOutput: Boolean(shell.commandOutput),
    hasCompletion: completion.completion.visible,
    hasSessionPicker: sessionPicker.state.visible,
    activeItems,
    runStateStatus: shell.runState.status,
    runningSubagentRunCount: subagentRuns.runningCount,
    pausedSubagentRunCount: subagentRuns.pausedCount,
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
    <ShellLayout
      shell={shell}
      cwd={cwd}
      modelAlias={modelAlias}
      tip={frozenTip}
      layoutMode={layoutMode}
      terminalWidth={terminalWidth}
      solidifiedItems={solidifiedItems}
      activeItems={activeItems}
      subagentRuns={subagentRuns}
      subagentRunDetails={subagentRunDetails}
      completion={completion}
      sessionPicker={sessionPicker}
      activeSurface={activeSurface}
      showPromptFrame={showPromptFrame}
      promptInputDisabled={promptInputDisabled}
      hasBlockingOverlay={hasBlockingOverlay}
      hasReview={hasReview}
      floatingReview={floatingReview}
      mcpStatus={mcpStatus}
    />
  );
}

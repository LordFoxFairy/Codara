/**
 * Shell layout component.
 *
 * Renders the full Ink box tree for the interactive CLI — solidified turn
 * history, the active transcript, floating overlays (session picker, command
 * output, subagent panel, review panel), the prompt frame, and the status
 * bar / footer chrome. All behavior lives in `useCliController`; this
 * component is pure presentation driven by the props it receives.
 */
import React from 'react';
import {Box, Static} from 'ink';
import {CommandOutputPanel} from '../components/chrome/command-output-panel';
import {Footer} from '../components/chrome/footer';
import {StatusBar} from '../components/chrome/header';
import {PersistentSpinner} from '../components/chrome/persistent-spinner';
import {SubagentRunPanel} from '../features/subagent/run-panel';
import {ReviewPanel} from '../features/review/panel';
import {SessionPicker} from '../features/session/picker';
import {ActiveTranscript} from '../features/transcript/render';
import {SolidifiedBlock} from '../features/transcript/solidified-block';
import {CompletionMenu} from '../features/composer/completion-menu';
import {PromptFrame} from '../features/composer/frame';
import {shouldShowFloatingSubagentRunPanel} from './shell-predicates';
import type {CliController} from './use-cli-controller';
import type {CliInteractionSurface, CliReviewState} from './view-state';
import type {UseCommandCompletionOutput} from '../features/composer/use-completion';
import type {UseSessionPickerOutput} from '../features/session/use-picker';
import type {UseSubagentRunsOutput} from '../features/subagent/use-runs';
import type {CliLayoutMode} from './layout-mode';
import type {SolidifiedItem, TranscriptItem} from '../features/transcript/model';

export interface ShellLayoutProps {
  shell: CliController;
  cwd: string;
  modelAlias: string;
  tip: string;
  layoutMode: CliLayoutMode;
  terminalWidth: number;
  solidifiedItems: readonly SolidifiedItem[];
  activeItems: readonly TranscriptItem[];
  subagentRuns: UseSubagentRunsOutput;
  subagentRunDetails: ReadonlyMap<string, TranscriptItem[]>;
  completion: UseCommandCompletionOutput;
  sessionPicker: UseSessionPickerOutput;
  activeSurface: CliInteractionSurface;
  showPromptFrame: boolean;
  promptInputDisabled: boolean;
  hasBlockingOverlay: boolean;
  hasReview: boolean;
  floatingReview: CliReviewState | undefined;
  mcpStatus?: {connected: number; total: number};
}

export function ShellLayout(props: ShellLayoutProps): React.JSX.Element {
  const {
    shell,
    cwd,
    modelAlias,
    tip,
    layoutMode,
    terminalWidth,
    solidifiedItems,
    activeItems,
    subagentRuns,
    subagentRunDetails,
    completion,
    sessionPicker,
    activeSurface,
    showPromptFrame,
    promptInputDisabled,
    hasBlockingOverlay,
    hasReview,
    floatingReview,
    mcpStatus,
  } = props;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={[...solidifiedItems]}>
        {(turn) => (
          <SolidifiedBlock
            key={turn.id}
            turn={turn}
            layoutMode={layoutMode}
            cwd={cwd}
            modelAlias={modelAlias}
            tip={tip}
            expandedAll={shell.expandedAll}
            subagentDetails={subagentRunDetails}
          />
        )}
      </Static>
      {activeItems.length > 0 && (
        <ActiveTranscript
          items={[...activeItems]}
          activeSubagentRuns={subagentRuns.runs}
          expandedAll={shell.expandedAll}
          subagentDetails={subagentRunDetails}
        />
      )}

      {/* Independent persistent spinner - only depends on runState.status */}
      {!shell.review && <PersistentSpinner runState={shell.runState} />}

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
        <CommandOutputPanel
          content={shell.commandOutput.content}
          commandName={shell.commandOutput.commandName}
          scrollOffset={shell.commandOutput.scrollOffset}
        />
      )}
      {shouldShowFloatingSubagentRunPanel({
        hasConversation: shell.hasConversation,
        subagentRunPanelVisible: shell.subagentRunPanelVisible,
        subagentRunCount: subagentRuns.runs.length,
        hasBlockingOverlay,
        hasReview,
      }) && (
        <Box marginTop={1}>
          <SubagentRunPanel
            runs={subagentRuns.runs}
            runningCount={subagentRuns.runningCount}
            pausedCount={subagentRuns.pausedCount}
            doneCount={subagentRuns.doneCount}
            errorCount={subagentRuns.errorCount}
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
    </Box>
  );
}

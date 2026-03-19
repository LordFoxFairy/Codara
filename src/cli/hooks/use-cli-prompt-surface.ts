import {useCallback, useMemo} from 'react';
import type {Codara} from '@/index';
import type {CliRunState} from '../app/view-state';
import {isComposerCursorOnFirstVisualLine, isComposerCursorOnLastVisualLine} from '../composer/state';
import type {CliComposerState} from '../composer/types';
import {useCommandCompletion, type CommandCompletionState} from './use-command-completion';
import {usePromptInput} from './use-prompt-input';

export interface CliPromptSurfaceStateInput {
  hasHilReview: boolean;
  sessionPickerVisible: boolean;
  autoExitOnSettledPrompt: boolean;
  hasInitialPrompt: boolean;
  hasCommandOutput: boolean;
  hasConversation: boolean;
  runStatus: CliRunState['status'];
  hasActiveTeams: boolean;
  selectedMemberName?: string;
}

export interface CliPromptSurfaceState {
  interactive: boolean;
  disabled: boolean;
  showCommandOutput: boolean;
  showPromptFrame: boolean;
  showSelectedMember: boolean;
  promptPlaceholder: string;
}

export interface UseCliPromptSurfaceInput {
  codara: Pick<Codara, 'listCommands'>;
  composer: CliComposerState;
  hasDraftContent: boolean;
  hasConversation: boolean;
  hasHilReview: boolean;
  sessionPickerVisible: boolean;
  autoExitOnSettledPrompt: boolean;
  hasInitialPrompt: boolean;
  runStatus: CliRunState['status'];
  hasCommandOutput: boolean;
  hasActiveTeams: boolean;
  selectedMemberName?: string;
  exit: () => void;
  dismissCommandOutput: () => void;
  scrollCommandOutput: (delta: number) => void;
  insertText: (input: string) => void;
  insertNewline: () => void;
  backspace: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorUp: (terminalWidth?: number) => void;
  moveCursorDown: (terminalWidth?: number) => void;
  moveCursorHome: (terminalWidth?: number) => void;
  moveCursorEnd: (terminalWidth?: number) => void;
  isBrowsingHistory: boolean;
  recallPreviousHistory: () => boolean;
  recallNextHistory: () => boolean;
  submitDraft: () => void;
  replaceText: (text: string) => void;
  toggleTaskPanel: () => void;
  toggleExpand: () => void;
  selectPreviousMember: () => void;
  selectNextMember: () => void;
  terminalWidth?: number;
}

export interface UseCliPromptSurfaceOutput extends CliPromptSurfaceState {
  completion: CommandCompletionState;
  selectedMemberName?: string;
}

export function resolveCliPromptSurfaceState(input: CliPromptSurfaceStateInput): CliPromptSurfaceState {
  const interactive = !input.hasHilReview
    && !input.sessionPickerVisible
    && !(input.autoExitOnSettledPrompt && input.hasInitialPrompt);
  const disabled = input.hasHilReview || input.sessionPickerVisible;
  const showCommandOutput = input.hasCommandOutput;
  const showPromptFrame = !input.hasHilReview;
  const showSelectedMember = showPromptFrame && input.hasActiveTeams && Boolean(input.selectedMemberName);
  const promptPlaceholder = input.hasConversation ? 'Reply to Codara...' : 'Ask Codara...';

  return {
    interactive,
    disabled,
    showCommandOutput,
    showPromptFrame,
    showSelectedMember,
    promptPlaceholder,
  };
}

// 这里只管输入区怎么显示、按键该路由到哪里。
// 真正的命令执行、会话状态和 HIL 语义仍然留在 controller 里。
export function useCliPromptSurface(input: UseCliPromptSurfaceInput): UseCliPromptSurfaceOutput {
  const {
    codara,
    composer,
    hasDraftContent,
    hasConversation,
    hasHilReview,
    sessionPickerVisible,
    autoExitOnSettledPrompt,
    hasInitialPrompt,
    runStatus,
    hasCommandOutput,
    hasActiveTeams,
    selectedMemberName,
    exit,
    dismissCommandOutput,
    scrollCommandOutput,
    insertText,
    insertNewline,
    backspace,
    moveCursorLeft,
    moveCursorRight,
    moveCursorUp,
    moveCursorDown,
    moveCursorHome,
    moveCursorEnd,
    isBrowsingHistory,
    recallPreviousHistory,
    recallNextHistory,
    submitDraft,
    replaceText,
    toggleTaskPanel,
    toggleExpand,
    selectPreviousMember,
    selectNextMember,
    terminalWidth,
  } = input;

  const listCommands = useCallback(() => codara.listCommands(), [codara]);
  const completionState = useCommandCompletion({
    text: composer.text,
    disabled: hasHilReview || sessionPickerVisible,
    listCommands,
  });

  const surface = useMemo(
    () => resolveCliPromptSurfaceState({
      hasHilReview,
      sessionPickerVisible,
      autoExitOnSettledPrompt,
      hasInitialPrompt,
      hasCommandOutput,
      hasConversation,
      runStatus,
      hasActiveTeams,
      selectedMemberName,
    }),
    [
      autoExitOnSettledPrompt,
      hasActiveTeams,
      hasCommandOutput,
      hasConversation,
      hasHilReview,
      hasInitialPrompt,
      runStatus,
      selectedMemberName,
      sessionPickerVisible,
    ],
  );

  usePromptInput({
    interactive: surface.interactive,
    disabled: surface.disabled,
    onInsertText: insertText,
    onInsertNewline: insertNewline,
    onBackspace: backspace,
    onMoveCursorLeft: moveCursorLeft,
    onMoveCursorRight: moveCursorRight,
    onMoveCursorUp: () => {
      if (hasCommandOutput && !hasDraftContent) {
        scrollCommandOutput(-1);
        return;
      }
      if (completionState.completion.visible) {
        completionState.moveUp();
        return;
      }
      if (isComposerCursorOnFirstVisualLine(composer, terminalWidth) && recallPreviousHistory()) {
        return;
      }
      moveCursorUp(terminalWidth);
    },
    onMoveCursorDown: () => {
      if (hasCommandOutput && !hasDraftContent) {
        scrollCommandOutput(1);
        return;
      }
      if (completionState.completion.visible) {
        completionState.moveDown();
        return;
      }
      if (isBrowsingHistory && isComposerCursorOnLastVisualLine(composer, terminalWidth) && recallNextHistory()) {
        return;
      }
      moveCursorDown(terminalWidth);
    },
    onMoveCursorHome: () => {
      moveCursorHome(terminalWidth);
    },
    onMoveCursorEnd: () => {
      moveCursorEnd(terminalWidth);
    },
    onSubmit: () => {
      if (completionState.completion.visible) {
        const accepted = completionState.accept();
        completionState.dismiss();
        if (accepted) {
          // 有补全时，Enter 先接收建议，不直接执行命令。
          replaceText(accepted);
        }
        return;
      }
      if (runStatus === 'running') {
        return;
      }
      submitDraft();
    },
    onExit: () => {
      if (completionState.completion.visible) {
        completionState.dismiss();
        return;
      }
      if (hasCommandOutput) {
        dismissCommandOutput();
        return;
      }
      exit();
    },
    onToggleTaskPanel: toggleTaskPanel,
    onToggleExpand: toggleExpand,
    onSelectMemberUp: selectPreviousMember,
    onSelectMemberDown: selectNextMember,
    onTab: () => {
      if (completionState.completion.visible) {
        const accepted = completionState.accept();
        if (accepted) {
          replaceText(accepted);
        }
        completionState.dismiss();
      }
    },
  });

  return {
    ...surface,
    completion: completionState.completion,
    selectedMemberName,
  };
}

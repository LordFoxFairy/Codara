/**
 * Builds the option bundle passed to `useCliInteractionInput`.
 *
 * Keeps `shell-app.tsx` focused on rendering by lifting the (rather large)
 * callback wiring into a single pure function. Given the controller,
 * completion/session pickers, and a couple of layout flags, it returns the
 * exact options object the hook expects.
 */
import {isPermissionReview} from '../features/review/panel';
import {shouldSpaceInsertIntoCliReviewDraft} from '../features/review/state-core';
import type {CliController} from './use-cli-controller';
import type {CliInteractionSurface} from './view-state';
import type {UseCliInteractionInputOptions} from '../hooks/use-cli-interaction-input';
import type {UseCommandCompletionOutput} from '../features/composer/use-completion';
import type {UseSessionPickerOutput} from '../features/session/use-picker';

export interface ShellInputBindingsInput {
  shell: CliController;
  completion: UseCommandCompletionOutput;
  sessionPicker: UseSessionPickerOutput;
  activeSurface: CliInteractionSurface;
  promptInputDisabled: boolean;
  hasReview: boolean;
  interactive: boolean;
  onExit: () => void;
}

export function buildShellInputBindings(input: ShellInputBindingsInput): UseCliInteractionInputOptions {
  const {
    shell,
    completion,
    sessionPicker,
    activeSurface,
    promptInputDisabled,
    hasReview,
    interactive,
    onExit,
  } = input;

  return {
    activeSurface,
    promptDisabled: promptInputDisabled,
    interactive,
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
      onExit();
    },
    onToggleAgentRunsPanel: shell.toggleSubagentRunsPanel,
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
  };
}

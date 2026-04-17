import {useInput, useStdin} from 'ink';
import type {CliInteractionSurface, PermissionStage} from '../app/view-state';
import {resolvePromptInputAction} from '../features/composer/input-action';
import {resolveReviewInputAction} from '../features/review/input-action';

export interface UseCliInteractionInputOptions {
  activeSurface: CliInteractionSurface;
  promptDisabled?: boolean;
  interactive?: boolean;
  reviewDisabled?: boolean;
  reviewSpaceInsertsText?: boolean;
  reviewPermissionStage?: PermissionStage;
  onPromptInsertText: (input: string) => void;
  onPromptInsertNewline: () => void;
  onPromptBackspace: () => void;
  onPromptMoveCursorLeft: () => void;
  onPromptMoveCursorRight: () => void;
  onPromptMoveCursorUp: () => void;
  onPromptMoveCursorDown: () => void;
  onPromptMoveCursorHome: () => void;
  onPromptMoveCursorEnd: () => void;
  onPromptSubmit: () => void;
  onExit: () => void;
  onToggleAgentRunsPanel?: () => void;
  onToggleExpand?: () => void;
  onFocusReview?: () => void;
  onReviewMoveLeft?: () => void;
  onReviewMoveRight?: () => void;
  onReviewSelectPrevious: () => void;
  onReviewSelectNext: () => void;
  onReviewSelectPreviousReview?: () => void;
  onReviewSelectNextReview?: () => void;
  onReviewToggleFocus: () => void;
  onReviewActivateSelection?: () => void;
  onReviewInsertText: (input: string) => void;
  onReviewInsertNewline: () => void;
  onReviewBackspace: () => void;
  onReviewSubmit: () => void;
  onReviewQuickAction?: (actionId: string) => void;
  onFocusPrompt?: () => void;
  onPermissionBack?: () => void;
  onPermissionConfirm?: () => void;
  onPermissionRejectSend?: () => void;
  onPermissionRejectSilent?: () => void;
  onCompletionMoveUp?: () => void;
  onCompletionMoveDown?: () => void;
  onCompletionAcceptSubmit?: () => void;
  onCompletionAcceptReplace?: () => void;
  onCompletionDismiss?: () => void;
  onCommandOutputScroll?: (delta: number) => void;
  onCommandOutputClose?: () => void;
  onSessionPickerMoveUp?: () => void;
  onSessionPickerMoveDown?: () => void;
  onSessionPickerSelect?: () => void;
  onSessionPickerCancel?: () => void;
}

export function useCliInteractionInput(options: UseCliInteractionInputOptions): void {
  const {
    activeSurface,
    promptDisabled = false,
    interactive = true,
    reviewDisabled = false,
    reviewSpaceInsertsText = false,
    reviewPermissionStage,
    onPromptInsertText,
    onPromptInsertNewline,
    onPromptBackspace,
    onPromptMoveCursorLeft,
    onPromptMoveCursorRight,
    onPromptMoveCursorUp,
    onPromptMoveCursorDown,
    onPromptMoveCursorHome,
    onPromptMoveCursorEnd,
    onPromptSubmit,
    onExit,
    onToggleAgentRunsPanel,
    onToggleExpand,
    onFocusReview,
    onReviewMoveLeft,
    onReviewMoveRight,
    onReviewSelectPrevious,
    onReviewSelectNext,
    onReviewSelectPreviousReview,
    onReviewSelectNextReview,
    onReviewToggleFocus,
    onReviewActivateSelection,
    onReviewInsertText,
    onReviewInsertNewline,
    onReviewBackspace,
    onReviewSubmit,
    onReviewQuickAction,
    onFocusPrompt,
    onPermissionBack,
    onPermissionConfirm,
    onPermissionRejectSend,
    onPermissionRejectSilent,
    onCompletionMoveUp,
    onCompletionMoveDown,
    onCompletionAcceptSubmit,
    onCompletionAcceptReplace,
    onCompletionDismiss,
    onCommandOutputScroll,
    onCommandOutputClose,
    onSessionPickerMoveUp,
    onSessionPickerMoveDown,
    onSessionPickerSelect,
    onSessionPickerCancel,
  } = options;
  const {isRawModeSupported} = useStdin();

  useInput((input, key) => {
    if (activeSurface === 'session-picker') {
      if ((key.ctrl && input === 'c') || key.escape) {
        (onSessionPickerCancel ?? onExit)();
        return;
      }
      if (key.upArrow) {
        onSessionPickerMoveUp?.();
        return;
      }
      if (key.downArrow) {
        onSessionPickerMoveDown?.();
        return;
      }
      if (key.return || input === '\r' || input === '\n') {
        onSessionPickerSelect?.();
        return;
      }
      return;
    }

    if (activeSurface === 'command-output') {
      const action = resolvePromptInputAction(input, key);
      if (action === 'exit') {
        onCommandOutputClose?.();
        return;
      }
      if (action === 'move-up') {
        onCommandOutputScroll?.(-1);
        return;
      }
      if (action === 'move-down') {
        onCommandOutputScroll?.(1);
        return;
      }
      if (action === 'submit') {
        onPromptSubmit();
      }
      return;
    }

    if (activeSurface === 'completion') {
      const action = resolvePromptInputAction(input, key);
      if (action === 'exit') {
        onCompletionDismiss?.();
        return;
      }
      if (action === 'move-up') {
        onCompletionMoveUp?.();
        return;
      }
      if (action === 'move-down') {
        onCompletionMoveDown?.();
        return;
      }
      if (action === 'tab') {
        onCompletionAcceptReplace?.();
        return;
      }
      if (action === 'submit') {
        onCompletionAcceptSubmit?.();
        return;
      }
      if (action === 'insert-text') {
        onCompletionDismiss?.();
        onPromptInsertText(input);
        return;
      }
      if (action === 'backspace') {
        onCompletionDismiss?.();
        onPromptBackspace();
      }
      return;
    }

    if (activeSurface === 'review') {
      const action = resolveReviewInputAction(input, key, reviewPermissionStage, reviewSpaceInsertsText);

      if (action === 'exit' && key.ctrl && input === 'c') {
        onExit();
        return;
      }
      if (reviewDisabled) {
        return;
      }
      if (action === 'exit') {
        onExit();
        return;
      }
      if (action === 'permission-back') {
        onPermissionBack?.();
        return;
      }
      if (action === 'permission-confirm') {
        onPermissionConfirm?.();
        return;
      }
      if (action === 'permission-reject-silent') {
        onPermissionRejectSilent?.();
        return;
      }
      if (action === 'permission-reject-send') {
        onPermissionRejectSend?.();
        return;
      }
      if (action === 'focus-prompt') {
        onFocusPrompt?.();
        return;
      }
      if (reviewPermissionStage !== 'always-confirm' && reviewPermissionStage !== 'reject-feedback' && !key.ctrl && !key.meta && onReviewQuickAction) {
        if (input === '1' || input === 'y') {
          onReviewQuickAction('allow_once');
          return;
        }
        if (input === '2' || input === 'a') {
          onReviewQuickAction('dont_ask_again');
          return;
        }
        if (input === '3' || input === 'n') {
          onReviewQuickAction('deny');
          return;
        }
      }
      if (action === 'select-previous') {
        onReviewSelectPrevious();
        return;
      }
      if (action === 'select-next') {
        onReviewSelectNext();
        return;
      }
      if (action === 'activate-selection') {
        if (onReviewActivateSelection) {
          onReviewActivateSelection();
          return;
        }
        onReviewInsertText(input);
        return;
      }
      if (action === 'select-previous-review') {
        onReviewSelectPreviousReview?.();
        return;
      }
      if (action === 'select-next-review') {
        onReviewSelectNextReview?.();
        return;
      }
      if (action === 'move-left') {
        (onReviewMoveLeft ?? onReviewToggleFocus)();
        return;
      }
      if (action === 'move-right') {
        (onReviewMoveRight ?? onReviewToggleFocus)();
        return;
      }
      if (key.upArrow) {
        onReviewSelectPrevious();
        return;
      }
      if (key.downArrow) {
        onReviewSelectNext();
        return;
      }
      if (action === 'insert-newline') {
        onReviewInsertNewline();
        return;
      }
      if (action === 'submit') {
        onReviewSubmit();
        return;
      }
      if (action === 'backspace') {
        onReviewBackspace();
        return;
      }
      if (action === 'insert-text') {
        onReviewInsertText(input);
      }
      return;
    }

    const action = resolvePromptInputAction(input, key);

    if (action === 'exit') {
      onExit();
      return;
    }
    if (action === 'toggle-agent-runs-panel') {
      onToggleAgentRunsPanel?.();
      return;
    }
    if (action === 'toggle-expand') {
      onToggleExpand?.();
      return;
    }
    if (action === 'focus-review') {
      onFocusReview?.();
      return;
    }
    if (promptDisabled) {
      return;
    }
    if (action === 'tab') {
      onCompletionAcceptReplace?.();
      return;
    }
    if (action === 'insert-newline') {
      onPromptInsertNewline();
      return;
    }
    if (action === 'submit') {
      onPromptSubmit();
      return;
    }
    if (action === 'move-left') {
      onPromptMoveCursorLeft();
      return;
    }
    if (action === 'move-right') {
      onPromptMoveCursorRight();
      return;
    }
    if (action === 'move-up') {
      onPromptMoveCursorUp();
      return;
    }
    if (action === 'move-down') {
      onPromptMoveCursorDown();
      return;
    }
    if (action === 'move-home') {
      onPromptMoveCursorHome();
      return;
    }
    if (action === 'move-end') {
      onPromptMoveCursorEnd();
      return;
    }
    if (action === 'backspace') {
      onPromptBackspace();
      return;
    }
    if (action === 'insert-text') {
      onPromptInsertText(input);
    }
  }, {isActive: interactive && isRawModeSupported});
}

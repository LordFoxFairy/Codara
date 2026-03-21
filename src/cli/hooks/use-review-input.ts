import {useInput, useStdin} from 'ink';
import type {PermissionStage} from '../components/permission/types';

interface UseReviewInputOptions {
  active: boolean;
  disabled?: boolean;
  /** Current permission stage (undefined = not a permission review) */
  permissionStage?: PermissionStage;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onSelectPreviousReview?: () => void;
  onSelectNextReview?: () => void;
  onToggleFocus: () => void;
  onActivateSelection?: () => void;
  onInsertText: (input: string) => void;
  onInsertNewline: () => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onExit: () => void;
  onQuickAction?: (actionId: string) => void;
  onToggleInputTarget?: () => void;
  /** Permission stage transitions */
  onPermissionBack?: () => void;
  onPermissionConfirm?: () => void;
  onPermissionRejectSend?: () => void;
  onPermissionRejectSilent?: () => void;
}

export type ReviewInputAction =
  | 'noop'
  | 'exit'
  | 'permission-back'
  | 'permission-confirm'
  | 'permission-reject-send'
  | 'permission-reject-silent'
  | 'toggle-input-target'
  | 'select-previous-review'
  | 'select-next-review'
  | 'toggle-focus'
  | 'move-left'
  | 'move-right'
  | 'activate-selection'
  | 'insert-newline'
  | 'submit'
  | 'backspace'
  | 'insert-text';

export function resolveReviewInputAction(
  input: string,
  key: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    return?: boolean;
    escape?: boolean;
    tab?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    backspace?: boolean;
    delete?: boolean;
  },
  permissionStage?: PermissionStage,
): ReviewInputAction {
  if (key.ctrl && input === 'c') {
    return 'exit';
  }

  if (key.ctrl && input === 'r') {
    return 'toggle-input-target';
  }

  if (permissionStage === 'always-confirm') {
    if (key.escape) {
      return 'permission-back';
    }
    if (key.return || input === '\r' || input === '\n') {
      return 'permission-confirm';
    }
    return 'noop';
  }

  if (permissionStage === 'reject-feedback') {
    if (key.escape) {
      return 'permission-reject-silent';
    }
    if (key.return || input === '\r' || input === '\n') {
      return 'permission-reject-send';
    }
    if (key.backspace || input === '\b' || (key.delete && !key.ctrl && !key.meta && !key.shift) || (key.ctrl && input === 'h')) {
      return 'backspace';
    }
    return !key.ctrl && !key.meta && input ? 'insert-text' : 'noop';
  }

  if (key.escape) {
    return 'exit';
  }

  if (key.tab) {
    return 'toggle-focus';
  }

  if (!key.ctrl && !key.meta && input === '[') {
    return 'select-previous-review';
  }

  if (!key.ctrl && !key.meta && input === ']') {
    return 'select-next-review';
  }

  if (!key.ctrl && !key.meta && input === ' ') {
    return 'activate-selection';
  }

  if (key.leftArrow) {
    return 'move-left';
  }

  if (key.rightArrow) {
    return 'move-right';
  }

  if ((key.shift && key.return) || (key.meta && key.return) || (key.ctrl && (input === 'j' || key.return))) {
    return 'insert-newline';
  }

  if (key.return || input === '\r' || input === '\n') {
    return 'submit';
  }

  if (key.backspace || input === '\b' || (key.delete && !key.ctrl && !key.meta && !key.shift) || (key.ctrl && input === 'h')) {
    return 'backspace';
  }

  return !key.ctrl && !key.meta && input ? 'insert-text' : 'noop';
}

export function useReviewInput(options: UseReviewInputOptions): void {
  const {
    active,
    disabled = false,
    permissionStage,
    onMoveLeft,
    onMoveRight,
    onSelectPrevious,
    onSelectNext,
    onSelectPreviousReview,
    onSelectNextReview,
    onToggleFocus,
    onActivateSelection,
    onInsertText,
    onInsertNewline,
    onBackspace,
    onSubmit,
    onExit,
    onQuickAction,
    onToggleInputTarget,
    onPermissionBack,
    onPermissionConfirm,
    onPermissionRejectSend,
    onPermissionRejectSilent,
  } = options;
  const {isRawModeSupported} = useStdin();

  useInput((input, key) => {
    const action = resolveReviewInputAction(input, key, permissionStage);

    if (action === 'exit' && key.ctrl && input === 'c') {
      onExit();
      return;
    }

    if (disabled) {
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

    if (action === 'toggle-input-target') {
      onToggleInputTarget?.();
      return;
    }

    // Quick actions for permission prompt stage
    if (permissionStage !== 'always-confirm' && permissionStage !== 'reject-feedback' && !key.ctrl && !key.meta && onQuickAction) {
      if (input === '1') {
        onQuickAction('allow_once');
        return;
      }
      if (input === '2') {
        onQuickAction('dont_ask_again');
        return;
      }
      if (input === '3') {
        onQuickAction('deny');
        return;
      }
      if (input === 'y') {
        onQuickAction('allow_once');
        return;
      }
      if (input === 'n') {
        onQuickAction('deny');
        return;
      }
      if (input === 'a') {
        onQuickAction('dont_ask_again');
        return;
      }
    }

    if (action === 'toggle-focus') {
      onToggleFocus();
      return;
    }

    if (action === 'activate-selection') {
      if (onActivateSelection) {
        onActivateSelection();
        return;
      }
      onInsertText(input);
      return;
    }

    if (action === 'select-previous-review') {
      onSelectPreviousReview?.();
      return;
    }

    if (action === 'select-next-review') {
      onSelectNextReview?.();
      return;
    }

    if (action === 'move-left') {
      (onMoveLeft ?? onToggleFocus)();
      return;
    }

    if (action === 'move-right') {
      (onMoveRight ?? onToggleFocus)();
      return;
    }

    if (key.upArrow) {
      onSelectPrevious();
      return;
    }

    if (key.downArrow) {
      onSelectNext();
      return;
    }

    if (action === 'insert-newline') {
      onInsertNewline();
      return;
    }

    if (action === 'submit') {
      onSubmit();
      return;
    }

    if (action === 'backspace') {
      onBackspace();
      return;
    }

    if (action === 'insert-text') {
      onInsertText(input);
    }
  }, {isActive: active && isRawModeSupported});
}

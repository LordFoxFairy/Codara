import {useInput, useStdin} from 'ink';
import type {PermissionStage} from '../components/permission/types';

interface UseHilInputOptions {
  active: boolean;
  disabled?: boolean;
  /** Current permission stage (undefined = not a permission review) */
  permissionStage?: PermissionStage;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onToggleFocus: () => void;
  onInsertText: (input: string) => void;
  onInsertNewline: () => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onExit: () => void;
  onQuickAction?: (actionId: string) => void;
  /** Permission stage transitions */
  onPermissionBack?: () => void;
  onPermissionConfirm?: () => void;
  onPermissionRejectSend?: () => void;
  onPermissionRejectSilent?: () => void;
}

export function useHilInput(options: UseHilInputOptions): void {
  const {
    active,
    disabled = false,
    permissionStage,
    onMoveLeft,
    onMoveRight,
    onSelectPrevious,
    onSelectNext,
    onToggleFocus,
    onInsertText,
    onInsertNewline,
    onBackspace,
    onSubmit,
    onExit,
    onQuickAction,
    onPermissionBack,
    onPermissionConfirm,
    onPermissionRejectSend,
    onPermissionRejectSilent,
  } = options;
  const {isRawModeSupported} = useStdin();

  useInput((input, key) => {
    // Ctrl+C always exits
    if (key.ctrl && input === 'c') {
      onExit();
      return;
    }

    if (disabled) {
      return;
    }

    // ── Permission stage 2: always-confirm (Claude Code style: Confirm/Cancel) ──
    if (permissionStage === 'always-confirm') {
      if (key.escape) {
        onPermissionBack?.();
        return;
      }
      if (key.return || input === '\r' || input === '\n') {
        onPermissionConfirm?.();
        return;
      }
      return;
    }

    // ── Permission stage 3: reject-feedback ──
    if (permissionStage === 'reject-feedback') {
      if (key.escape) {
        onPermissionRejectSilent?.();
        return;
      }
      if (key.return || input === '\r' || input === '\n') {
        onPermissionRejectSend?.();
        return;
      }
      if (key.backspace || input === '\b' || (key.delete && !key.ctrl && !key.meta && !key.shift) || (key.ctrl && input === 'h')) {
        onBackspace();
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        onInsertText(input);
      }
      return;
    }

    // ── Permission stage 1 (prompt) or general Esc ──
    if (key.escape) {
      onExit();
      return;
    }

    // Quick actions for permission prompt stage
    if (!key.ctrl && !key.meta && onQuickAction) {
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

    if (key.tab) {
      onToggleFocus();
      return;
    }

    if (key.leftArrow) {
      (onMoveLeft ?? onToggleFocus)();
      return;
    }

    if (key.rightArrow) {
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

    if ((key.shift && key.return) || (key.meta && key.return) || (key.ctrl && key.return)) {
      onInsertNewline();
      return;
    }

    if (key.return || input === '\r' || input === '\n') {
      onSubmit();
      return;
    }

    if (key.backspace || input === '\b' || (key.delete && !key.ctrl && !key.meta && !key.shift) || (key.ctrl && input === 'h')) {
      onBackspace();
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      onInsertText(input);
    }
  }, {isActive: active && isRawModeSupported});
}

import {useInput, useStdin} from 'ink';

interface UseHilInputOptions {
  active: boolean;
  disabled?: boolean;
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
}

export function useHilInput(options: UseHilInputOptions): void {
  const {
    active,
    disabled = false,
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
  } = options;
  const {isRawModeSupported} = useStdin();

  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || key.escape) {
      onExit();
      return;
    }

    if (disabled) {
      return;
    }

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

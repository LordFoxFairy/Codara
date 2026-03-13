import {useInput, useStdin} from 'ink';

interface UseHilInputOptions {
  active: boolean;
  disabled?: boolean;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onToggleFocus: () => void;
  onInsertText: (input: string) => void;
  onInsertNewline: () => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onExit: () => void;
}

export function useHilInput(options: UseHilInputOptions): void {
  const {
    active,
    disabled = false,
    onSelectPrevious,
    onSelectNext,
    onToggleFocus,
    onInsertText,
    onInsertNewline,
    onBackspace,
    onSubmit,
    onExit,
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

    if (key.tab || key.leftArrow || key.rightArrow) {
      onToggleFocus();
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

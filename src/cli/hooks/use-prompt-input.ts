import {useInput, useStdin} from 'ink';
import {resolvePromptInputAction} from './prompt-input-action';

interface UsePromptInputOptions {
  interactive?: boolean;
  disabled: boolean;
  onInsertText: (input: string) => void;
  onInsertNewline: () => void;
  onBackspace: () => void;
  onMoveCursorLeft: () => void;
  onMoveCursorRight: () => void;
  onMoveCursorUp: () => void;
  onMoveCursorDown: () => void;
  onMoveCursorHome: () => void;
  onMoveCursorEnd: () => void;
  onSubmit: () => void;
  onExit: () => void;
}

// 输入监听独立成 hook，避免展示组件和编辑动作混在一起。
export function usePromptInput(options: UsePromptInputOptions): void {
  const {
    interactive = true,
    disabled,
    onInsertText,
    onInsertNewline,
    onBackspace,
    onMoveCursorLeft,
    onMoveCursorRight,
    onMoveCursorUp,
    onMoveCursorDown,
    onMoveCursorHome,
    onMoveCursorEnd,
    onSubmit,
    onExit,
  } = options;
  const {isRawModeSupported} = useStdin();

  useInput((input, key) => {
    const action = resolvePromptInputAction(input, key);

    if (action === 'exit') {
      onExit();
      return;
    }

    if (disabled) {
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

    if (action === 'move-left') {
      onMoveCursorLeft();
      return;
    }

    if (action === 'move-right') {
      onMoveCursorRight();
      return;
    }

    if (action === 'move-up') {
      onMoveCursorUp();
      return;
    }

    if (action === 'move-down') {
      onMoveCursorDown();
      return;
    }

    if (action === 'move-home') {
      onMoveCursorHome();
      return;
    }

    if (action === 'move-end') {
      onMoveCursorEnd();
      return;
    }

    if (action === 'backspace') {
      onBackspace();
      return;
    }

    if (action === 'insert-text') {
      onInsertText(input);
    }
  }, {isActive: interactive && isRawModeSupported});
}

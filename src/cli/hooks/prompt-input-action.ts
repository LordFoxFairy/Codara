export type PromptInputAction =
  | 'exit'
  | 'insert-newline'
  | 'submit'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'move-home'
  | 'move-end'
  | 'backspace'
  | 'insert-text'
  | 'toggle-task-panel'
  | 'tab'
  | 'noop';

export interface PromptInputKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  return?: boolean;
  escape?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  home?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

// Ink 当前会把不少终端送来的 DEL(127) 解析成 delete；在 CLI 里优先保证 Backspace 退格正确。
export function resolvePromptInputAction(input: string, key: PromptInputKey): PromptInputAction {
  if ((key.ctrl && input === 'c') || key.escape) {
    return 'exit';
  }

  if (key.ctrl && input === 't') {
    return 'toggle-task-panel';
  }

  if (input === '\t') {
    return 'tab';
  }

  if ((key.shift && key.return) || (key.meta && key.return) || (key.ctrl && (input === 'j' || key.return))) {
    return 'insert-newline';
  }

  if (key.return || input === '\r' || input === '\n') {
    return 'submit';
  }

  if (key.leftArrow) {
    return 'move-left';
  }

  if (key.rightArrow) {
    return 'move-right';
  }

  if (key.upArrow) {
    return 'move-up';
  }

  if (key.downArrow) {
    return 'move-down';
  }

  if (key.home || (key.ctrl && input === 'a')) {
    return 'move-home';
  }

  if (key.end || (key.ctrl && input === 'e')) {
    return 'move-end';
  }

  if (key.backspace || input === '\b' || (key.delete && !key.ctrl && !key.meta && !key.shift) || (key.ctrl && input === 'h')) {
    return 'backspace';
  }

  if (!key.ctrl && !key.meta && input) {
    return 'insert-text';
  }

  return 'noop';
}

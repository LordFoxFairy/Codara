import type {PermissionStage} from '../app/review-types';

export type ReviewInputAction =
  | 'noop'
  | 'exit'
  | 'permission-back'
  | 'permission-confirm'
  | 'permission-reject-send'
  | 'permission-reject-silent'
  | 'focus-prompt'
  | 'select-previous-review'
  | 'select-next-review'
  | 'select-previous'
  | 'select-next'
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
  spaceInsertsText = false,
): ReviewInputAction {
  if (key.ctrl && input === 'c') {
    return 'exit';
  }

  if (key.ctrl && input === 'r') {
    return 'focus-prompt';
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
    return key.shift ? 'select-previous' : 'select-next';
  }

  if (!key.ctrl && !key.meta && input === '[') {
    return 'select-previous-review';
  }

  if (!key.ctrl && !key.meta && input === ']') {
    return 'select-next-review';
  }

  if (!key.ctrl && !key.meta && input === ' ') {
    if (spaceInsertsText) {
      return 'insert-text';
    }
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

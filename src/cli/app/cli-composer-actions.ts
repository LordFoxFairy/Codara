/** Pure composer state update functions for the CLI text input. */
import type {CliComposerState} from '../composer/state';
import {
  backspaceComposerText,
  insertComposerNewline,
  insertComposerText,
  moveComposerCursorDown,
  moveComposerCursorEnd,
  moveComposerCursorHome,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUp,
  replaceComposerText,
} from '../composer/state';

/**
 * Pure composer actions: state in -> state out.
 * The React hook wraps each in a useCallback that passes current state.
 */

export function composerInsertText(state: CliComposerState, input: string): CliComposerState {
  return insertComposerText(state, input);
}

export function composerReplaceText(text: string): CliComposerState {
  return replaceComposerText(text);
}

export function composerInsertNewline(state: CliComposerState): CliComposerState {
  return insertComposerNewline(state);
}

export function composerBackspace(state: CliComposerState): CliComposerState {
  return backspaceComposerText(state);
}

export function composerMoveCursorLeft(state: CliComposerState): CliComposerState {
  return moveComposerCursorLeft(state);
}

export function composerMoveCursorRight(state: CliComposerState): CliComposerState {
  return moveComposerCursorRight(state);
}

export function composerMoveCursorUp(state: CliComposerState): CliComposerState {
  return moveComposerCursorUp(state);
}

export function composerMoveCursorDown(state: CliComposerState): CliComposerState {
  return moveComposerCursorDown(state);
}

export function composerMoveCursorHome(state: CliComposerState): CliComposerState {
  return moveComposerCursorHome(state);
}

export function composerMoveCursorEnd(state: CliComposerState): CliComposerState {
  return moveComposerCursorEnd(state);
}

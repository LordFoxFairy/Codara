import type {CliComposerState} from './types';

export function createComposerState(text = '', cursorOffset = text.length): CliComposerState {
  const normalizedText = normalizeComposerText(text);
  return {
    text: normalizedText,
    cursorOffset: clampCursorOffset(cursorOffset, normalizedText),
  };
}

export function clampCursorOffset(cursorOffset: number, text: string): number {
  return Math.max(0, Math.min(cursorOffset, text.length));
}

export function insertComposerText(state: CliComposerState, input: string): CliComposerState {
  const normalizedInput = normalizeComposerText(input);
  const before = state.text.slice(0, state.cursorOffset);
  const after = state.text.slice(state.cursorOffset);
  const text = `${before}${normalizedInput}${after}`;

  return {
    text,
    cursorOffset: state.cursorOffset + normalizedInput.length,
  };
}

export function replaceComposerText(newText: string): CliComposerState {
  const normalizedText = normalizeComposerText(newText);
  return {
    text: normalizedText,
    cursorOffset: normalizedText.length,
  };
}

export function insertComposerNewline(state: CliComposerState): CliComposerState {
  return insertComposerText(state, '\n');
}

export function backspaceComposerText(state: CliComposerState): CliComposerState {
  if (state.cursorOffset === 0) {
    return state;
  }

  return {
    text: `${state.text.slice(0, state.cursorOffset - 1)}${state.text.slice(state.cursorOffset)}`,
    cursorOffset: state.cursorOffset - 1,
  };
}

export function moveComposerCursorLeft(state: CliComposerState): CliComposerState {
  return {
    ...state,
    cursorOffset: clampCursorOffset(state.cursorOffset - 1, state.text),
  };
}

export function moveComposerCursorRight(state: CliComposerState): CliComposerState {
  return {
    ...state,
    cursorOffset: clampCursorOffset(state.cursorOffset + 1, state.text),
  };
}

function normalizeComposerText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getCurrentLineStart(text: string, cursorOffset: number): number {
  const currentLineStart = text.lastIndexOf('\n', Math.max(0, cursorOffset - 1));
  return currentLineStart === -1 ? 0 : currentLineStart + 1;
}

function getCurrentLineEnd(text: string, cursorOffset: number): number {
  const currentLineEnd = text.indexOf('\n', cursorOffset);
  return currentLineEnd === -1 ? text.length : currentLineEnd;
}

export function moveComposerCursorHome(state: CliComposerState): CliComposerState {
  return {
    ...state,
    cursorOffset: getCurrentLineStart(state.text, state.cursorOffset),
  };
}

export function moveComposerCursorEnd(state: CliComposerState): CliComposerState {
  return {
    ...state,
    cursorOffset: getCurrentLineEnd(state.text, state.cursorOffset),
  };
}

export function moveComposerCursorUp(state: CliComposerState): CliComposerState {
  const currentLineStart = getCurrentLineStart(state.text, state.cursorOffset);
  if (currentLineStart === 0) {
    return state;
  }

  const previousLineEnd = currentLineStart - 1;
  const previousLineStart = getCurrentLineStart(state.text, previousLineEnd);
  const column = state.cursorOffset - currentLineStart;
  const previousLineLength = previousLineEnd - previousLineStart;

  return {
    ...state,
    cursorOffset: previousLineStart + Math.min(column, previousLineLength),
  };
}

export function moveComposerCursorDown(state: CliComposerState): CliComposerState {
  const currentLineStart = getCurrentLineStart(state.text, state.cursorOffset);
  const currentLineEnd = getCurrentLineEnd(state.text, state.cursorOffset);
  if (currentLineEnd === state.text.length) {
    return state;
  }

  const nextLineStart = currentLineEnd + 1;
  const nextLineEnd = getCurrentLineEnd(state.text, nextLineStart);
  const column = state.cursorOffset - currentLineStart;
  const nextLineLength = nextLineEnd - nextLineStart;

  return {
    ...state,
    cursorOffset: nextLineStart + Math.min(column, nextLineLength),
  };
}

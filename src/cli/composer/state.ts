import type {CliComposerState} from './types';

const DEFAULT_TERMINAL_WIDTH = 120;
const COMPOSER_PREFIX_WIDTH = 2;
const COMPOSER_HORIZONTAL_PADDING = 2;

export interface ComposerVisualLine {
  startOffset: number;
  endOffset: number;
}

export interface ComposerVisualLayout {
  lines: ComposerVisualLine[];
  cursorLineIndex: number;
  cursorColumn: number;
}

export interface ComposerVerticalMoveResult {
  state: CliComposerState;
  preferredColumn: number;
}

interface WrappedCursorPosition {
  segmentIndex: number;
  localOffset: number;
}

function normalizeComposerText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function normalizeComposerTextWithCursor(text: string, cursorOffset: number): CliComposerState {
  const clampedCursorOffset = clampCursorOffset(cursorOffset, text);
  const beforeCursor = normalizeComposerText(text.slice(0, clampedCursorOffset));
  const afterCursor = normalizeComposerText(text.slice(clampedCursorOffset));

  return {
    text: `${beforeCursor}${afterCursor}`,
    cursorOffset: beforeCursor.length,
  };
}

export function createComposerState(text = '', cursorOffset = text.length): CliComposerState {
  return normalizeComposerTextWithCursor(text, cursorOffset);
}

export function clampCursorOffset(cursorOffset: number, text: string): number {
  return Math.max(0, Math.min(cursorOffset, text.length));
}

export function insertComposerText(state: CliComposerState, input: string): CliComposerState {
  const before = state.text.slice(0, state.cursorOffset);
  const after = state.text.slice(state.cursorOffset);
  const normalizedInput = normalizeComposerText(input);
  const text = `${before}${normalizedInput}${after}`;

  return {
    text,
    cursorOffset: state.cursorOffset + normalizedInput.length,
  };
}

export function replaceComposerText(newText: string): CliComposerState {
  return normalizeComposerTextWithCursor(newText, newText.length);
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

function softWrapLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) {
    return [line];
  }

  const result: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    result.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  result.push(remaining);
  return result;
}

function resolveWrappedCursorPosition(segments: string[], cursorColumn: number): WrappedCursorPosition {
  let charsSeen = 0;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? '';
    const segmentStart = charsSeen;
    const segmentEnd = charsSeen + segment.length;
    const hasFollowingSegment = index < segments.length - 1;

    if (cursorColumn < segmentEnd) {
      return {
        segmentIndex: index,
        localOffset: cursorColumn - segmentStart,
      };
    }

    if (cursorColumn === segmentEnd) {
      if (hasFollowingSegment && segment.length > 0) {
        charsSeen = segmentEnd;
        continue;
      }

      return {
        segmentIndex: index,
        localOffset: segment.length,
      };
    }

    charsSeen = segmentEnd;
  }

  const lastIndex = Math.max(0, segments.length - 1);
  return {
    segmentIndex: lastIndex,
    localOffset: segments[lastIndex]?.length ?? 0,
  };
}

export function resolveComposerWrapWidth(terminalWidth?: number): number {
  const availableWidth = (terminalWidth ?? DEFAULT_TERMINAL_WIDTH) - COMPOSER_PREFIX_WIDTH - COMPOSER_HORIZONTAL_PADDING;
  return Math.max(1, availableWidth);
}

function getCurrentLineStart(text: string, cursorOffset: number): number {
  const currentLineStart = text.lastIndexOf('\n', Math.max(0, cursorOffset - 1));
  return currentLineStart === -1 ? 0 : currentLineStart + 1;
}

function getCurrentLineEnd(text: string, cursorOffset: number): number {
  const currentLineEnd = text.indexOf('\n', cursorOffset);
  return currentLineEnd === -1 ? text.length : currentLineEnd;
}

export function isComposerCursorOnFirstLine(state: CliComposerState): boolean {
  return getCurrentLineStart(state.text, state.cursorOffset) === 0;
}

export function isComposerCursorOnLastLine(state: CliComposerState): boolean {
  return getCurrentLineEnd(state.text, state.cursorOffset) === state.text.length;
}

export function getComposerVisualLayout(
  state: CliComposerState,
  terminalWidth?: number,
): ComposerVisualLayout {
  const wrapWidth = resolveComposerWrapWidth(terminalWidth);
  const logicalLines = state.text.split('\n');
  const beforeCursor = state.text.slice(0, state.cursorOffset);
  const beforeLines = beforeCursor.split('\n');
  const logicalCursorLine = beforeLines.length - 1;
  const cursorColumn = beforeLines[logicalCursorLine]?.length ?? 0;

  const lines: ComposerVisualLine[] = [];
  let cursorLineIndex = 0;
  let cursorVisualColumn = 0;
  let textOffset = 0;

  for (let logicalIndex = 0; logicalIndex < logicalLines.length; logicalIndex++) {
    const logicalLine = logicalLines[logicalIndex] ?? '';
    const wrappedSegments = softWrapLine(logicalLine, wrapWidth);
    const cursorPosition = logicalIndex === logicalCursorLine
      ? resolveWrappedCursorPosition(wrappedSegments, cursorColumn)
      : undefined;
    let charsSeen = 0;

    for (let segmentIndex = 0; segmentIndex < wrappedSegments.length; segmentIndex++) {
      const segment = wrappedSegments[segmentIndex] ?? '';
      const startOffset = textOffset + charsSeen;
      const endOffset = startOffset + segment.length;

      lines.push({startOffset, endOffset});
      if (cursorPosition && segmentIndex === cursorPosition.segmentIndex) {
        cursorLineIndex = lines.length - 1;
        cursorVisualColumn = cursorPosition.localOffset;
      }

      charsSeen = endOffset - textOffset;
    }

    textOffset += logicalLine.length;
    if (logicalIndex < logicalLines.length - 1) {
      textOffset += 1;
    }
  }

  if (lines.length === 0) {
    return {
      lines: [{startOffset: 0, endOffset: 0}],
      cursorLineIndex: 0,
      cursorColumn: 0,
    };
  }

  return {
    lines,
    cursorLineIndex,
    cursorColumn: cursorVisualColumn,
  };
}

export function isComposerCursorOnFirstVisualLine(state: CliComposerState, terminalWidth?: number): boolean {
  return getComposerVisualLayout(state, terminalWidth).cursorLineIndex === 0;
}

export function isComposerCursorOnLastVisualLine(state: CliComposerState, terminalWidth?: number): boolean {
  const layout = getComposerVisualLayout(state, terminalWidth);
  return layout.cursorLineIndex === layout.lines.length - 1;
}

export function moveComposerCursorHome(state: CliComposerState, terminalWidth?: number): CliComposerState {
  const layout = getComposerVisualLayout(state, terminalWidth);
  return {
    ...state,
    cursorOffset: layout.lines[layout.cursorLineIndex]?.startOffset ?? state.cursorOffset,
  };
}

export function moveComposerCursorEnd(state: CliComposerState, terminalWidth?: number): CliComposerState {
  const layout = getComposerVisualLayout(state, terminalWidth);
  return {
    ...state,
    cursorOffset: layout.lines[layout.cursorLineIndex]?.endOffset ?? state.cursorOffset,
  };
}

function moveComposerCursorVertically(
  state: CliComposerState,
  direction: -1 | 1,
  terminalWidth?: number,
  preferredColumn?: number,
): ComposerVerticalMoveResult {
  const layout = getComposerVisualLayout(state, terminalWidth);
  const targetLineIndex = layout.cursorLineIndex + direction;
  const desiredColumn = preferredColumn ?? layout.cursorColumn;

  if (targetLineIndex < 0 || targetLineIndex >= layout.lines.length) {
    return {
      state,
      preferredColumn: desiredColumn,
    };
  }

  const targetLine = layout.lines[targetLineIndex];
  if (!targetLine) {
    return {
      state,
      preferredColumn: desiredColumn,
    };
  }

  const targetLength = targetLine.endOffset - targetLine.startOffset;
  return {
    state: {
      ...state,
      cursorOffset: targetLine.startOffset + Math.min(desiredColumn, targetLength),
    },
    preferredColumn: desiredColumn,
  };
}

export function moveComposerCursorUp(
  state: CliComposerState,
  terminalWidth?: number,
  preferredColumn?: number,
): CliComposerState {
  return moveComposerCursorVertically(state, -1, terminalWidth, preferredColumn).state;
}

export function moveComposerCursorDown(
  state: CliComposerState,
  terminalWidth?: number,
  preferredColumn?: number,
): CliComposerState {
  return moveComposerCursorVertically(state, 1, terminalWidth, preferredColumn).state;
}

export function moveComposerCursorUpWithPreference(
  state: CliComposerState,
  terminalWidth?: number,
  preferredColumn?: number,
): ComposerVerticalMoveResult {
  return moveComposerCursorVertically(state, -1, terminalWidth, preferredColumn);
}

export function moveComposerCursorDownWithPreference(
  state: CliComposerState,
  terminalWidth?: number,
  preferredColumn?: number,
): ComposerVerticalMoveResult {
  return moveComposerCursorVertically(state, 1, terminalWidth, preferredColumn);
}

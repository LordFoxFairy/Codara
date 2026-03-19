import {getComposerVisualLayout} from '../../composer/state';
import type {CliComposerState} from '../../composer/types';

export const COMPOSER_VIEWPORT_LINE_LIMIT = 6;

export interface ComposerRenderLine {
  beforeCursor: string;
  afterCursor: string;
  placeholder?: string;
  isCursorLine: boolean;
}

export interface ComposerViewport {
  lines: ComposerRenderLine[];
  hasOverflowAbove: boolean;
  hasOverflowBelow: boolean;
}

function buildComposerLines(
  composer: CliComposerState,
  placeholder?: string,
  terminalWidth?: number,
): {lines: ComposerRenderLine[]; cursorLineIndex: number} {
  if (!composer.text) {
    return {
      lines: [
        {
          beforeCursor: '',
          afterCursor: '',
          placeholder: placeholder ?? 'Try "fix lint errors"',
          isCursorLine: true,
        },
      ],
      cursorLineIndex: 0,
    };
  }

  const layout = getComposerVisualLayout(composer, terminalWidth);
  const lines = layout.lines.map((line, index) => {
    if (index < layout.cursorLineIndex) {
      return {
        beforeCursor: composer.text.slice(line.startOffset, line.endOffset),
        afterCursor: '',
        isCursorLine: false,
      };
    }

    if (index > layout.cursorLineIndex) {
      return {
        beforeCursor: '',
        afterCursor: composer.text.slice(line.startOffset, line.endOffset),
        isCursorLine: false,
      };
    }

    return {
      beforeCursor: composer.text.slice(line.startOffset, composer.cursorOffset),
      afterCursor: composer.text.slice(composer.cursorOffset, line.endOffset),
      isCursorLine: true,
    };
  });

  return {
    lines,
    cursorLineIndex: layout.cursorLineIndex,
  };
}

function resolveViewportStart(cursorLineIndex: number, lineCount: number, limit: number): number {
  if (lineCount <= limit) {
    return 0;
  }

  const centeredStart = cursorLineIndex - Math.floor(limit / 2);
  return Math.max(0, Math.min(centeredStart, lineCount - limit));
}

export function buildComposerViewport(
  composer: CliComposerState,
  lineLimit?: number,
  placeholder?: string,
  terminalWidth?: number,
): ComposerViewport {
  const {lines, cursorLineIndex} = buildComposerLines(composer, placeholder, terminalWidth);
  if (lineLimit === undefined) {
    return {
      lines,
      hasOverflowAbove: false,
      hasOverflowBelow: false,
    };
  }
  const viewportStart = resolveViewportStart(cursorLineIndex, lines.length, lineLimit);
  const viewportEnd = Math.min(lines.length, viewportStart + lineLimit);

  return {
    lines: lines.slice(viewportStart, viewportEnd),
    hasOverflowAbove: viewportStart > 0,
    hasOverflowBelow: viewportEnd < lines.length,
  };
}

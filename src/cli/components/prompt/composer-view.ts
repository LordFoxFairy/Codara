import type {CliComposerState} from '../../composer/types';

export const COMPOSER_VIEWPORT_LINE_LIMIT = 4;

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

function buildComposerLines(composer: CliComposerState, placeholder?: string): {lines: ComposerRenderLine[]; cursorLineIndex: number} {
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

  const beforeCursor = composer.text.slice(0, composer.cursorOffset);
  const sourceLines = composer.text.split('\n');
  const beforeLines = beforeCursor.split('\n');
  const cursorLineIndex = beforeLines.length - 1;
  const cursorColumn = beforeLines[cursorLineIndex]?.length ?? 0;

  return {
    lines: sourceLines.map((line, index) => {
      if (index < cursorLineIndex) {
        return {
          beforeCursor: line,
          afterCursor: '',
          isCursorLine: false,
        };
      }

      if (index > cursorLineIndex) {
        return {
          beforeCursor: '',
          afterCursor: line,
          isCursorLine: false,
        };
      }

      return {
        beforeCursor: line.slice(0, cursorColumn),
        afterCursor: line.slice(cursorColumn),
        isCursorLine: true,
      };
    }),
    cursorLineIndex,
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
  lineLimit = COMPOSER_VIEWPORT_LINE_LIMIT,
  placeholder?: string
): ComposerViewport {
  const {lines, cursorLineIndex} = buildComposerLines(composer, placeholder);
  const viewportStart = resolveViewportStart(cursorLineIndex, lines.length, lineLimit);
  const viewportEnd = Math.min(lines.length, viewportStart + lineLimit);

  return {
    lines: lines.slice(viewportStart, viewportEnd),
    hasOverflowAbove: viewportStart > 0,
    hasOverflowBelow: viewportEnd < lines.length,
  };
}

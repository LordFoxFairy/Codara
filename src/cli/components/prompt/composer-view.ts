import type {CliComposerState} from '../../composer/types';

export const COMPOSER_VIEWPORT_LINE_LIMIT = 6;

/** Prefix width: "> " or "  " = 2 chars. */
const PREFIX_WIDTH = 2;

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

/**
 * Soft-wrap a single logical line into multiple visual lines.
 * Returns an array of substrings, each fitting within `width`.
 */
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

/**
 * Build visual lines from the composer state with soft-wrapping.
 * Each logical line (separated by \n) is soft-wrapped at `wrapWidth`.
 */
function buildComposerLines(
  composer: CliComposerState,
  wrapWidth: number,
  placeholder?: string,
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

  const beforeCursor = composer.text.slice(0, composer.cursorOffset);
  const logicalLines = composer.text.split('\n');
  const beforeLines = beforeCursor.split('\n');
  const logicalCursorLine = beforeLines.length - 1;
  const cursorColumn = beforeLines[logicalCursorLine]?.length ?? 0;

  const renderLines: ComposerRenderLine[] = [];
  let visualCursorLine = -1;

  for (let i = 0; i < logicalLines.length; i++) {
    const logicalLine = logicalLines[i]!;

    if (i === logicalCursorLine) {
      // This logical line contains the cursor — wrap it with cursor position tracking
      const wrappedFull = softWrapLine(logicalLine, wrapWidth);
      let charsSeen = 0;

      for (let w = 0; w < wrappedFull.length; w++) {
        const segment = wrappedFull[w]!;
        const segmentStart = charsSeen;
        const segmentEnd = charsSeen + segment.length;

        if (cursorColumn >= segmentStart && cursorColumn <= segmentEnd) {
          // Cursor is on this visual line
          const localOffset = cursorColumn - segmentStart;
          visualCursorLine = renderLines.length;
          renderLines.push({
            beforeCursor: segment.slice(0, localOffset),
            afterCursor: segment.slice(localOffset),
            isCursorLine: true,
          });
        } else {
          renderLines.push({
            beforeCursor: segment,
            afterCursor: '',
            isCursorLine: false,
          });
        }
        charsSeen = segmentEnd;
      }
    } else {
      // Non-cursor line — simple wrap
      const wrapped = softWrapLine(logicalLine, wrapWidth);
      for (const segment of wrapped) {
        renderLines.push({
          beforeCursor: i < logicalCursorLine ? segment : '',
          afterCursor: i < logicalCursorLine ? '' : segment,
          isCursorLine: false,
        });
      }
    }
  }

  if (visualCursorLine < 0) {
    visualCursorLine = 0;
  }

  return {lines: renderLines, cursorLineIndex: visualCursorLine};
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
  placeholder?: string,
  terminalWidth?: number,
): ComposerViewport {
  const availableWidth = (terminalWidth ?? 120) - PREFIX_WIDTH - 2; // 2 for padding
  const wrapWidth = Math.max(20, availableWidth);
  const {lines, cursorLineIndex} = buildComposerLines(composer, wrapWidth, placeholder);
  const viewportStart = resolveViewportStart(cursorLineIndex, lines.length, lineLimit);
  const viewportEnd = Math.min(lines.length, viewportStart + lineLimit);

  return {
    lines: lines.slice(viewportStart, viewportEnd),
    hasOverflowAbove: viewportStart > 0,
    hasOverflowBelow: viewportEnd < lines.length,
  };
}

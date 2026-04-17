import type {CliComposerState} from '../composer/state';

export const COMPOSER_VIEWPORT_LINE_LIMIT = 10;

/** Prefix width: "> " or "  " = 2 chars. */
const PREFIX_WIDTH = 2;
const MIN_WRAP_WIDTH = 8;

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

interface WrappedSegment {
  text: string;
  startWidth: number;
  endWidth: number;
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }

  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
      || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) {
    return 2;
  }

  return 1;
}

function measureDisplayWidth(text: string): number {
  let width = 0;
  for (const char of Array.from(text)) {
    width += charDisplayWidth(char);
  }
  return width;
}

function splitAtDisplayWidth(text: string, targetWidth: number): {before: string; after: string} {
  if (targetWidth <= 0) {
    return {before: '', after: text};
  }

  let width = 0;
  let index = 0;
  for (const char of Array.from(text)) {
    const nextWidth = width + charDisplayWidth(char);
    if (nextWidth > targetWidth) {
      break;
    }
    width = nextWidth;
    index += char.length;
    if (width === targetWidth) {
      break;
    }
  }

  return {
    before: text.slice(0, index),
    after: text.slice(index),
  };
}

/**
 * Soft-wrap a single logical line into multiple visual lines.
 * Returns an array of substrings, each fitting within `width`.
 */
function softWrapLine(line: string, width: number): WrappedSegment[] {
  const totalWidth = measureDisplayWidth(line);
  if (width <= 0 || totalWidth <= width) {
    return [{text: line, startWidth: 0, endWidth: totalWidth}];
  }

  const result: WrappedSegment[] = [];
  let segmentText = '';
  let segmentWidth = 0;
  let consumedWidth = 0;

  for (const char of Array.from(line)) {
    const charWidth = charDisplayWidth(char);
    if (segmentWidth > 0 && segmentWidth + charWidth > width) {
      result.push({
        text: segmentText,
        startWidth: consumedWidth - segmentWidth,
        endWidth: consumedWidth,
      });
      segmentText = '';
      segmentWidth = 0;
    }

    segmentText += char;
    segmentWidth += charWidth;
    consumedWidth += charWidth;
  }

  result.push({
    text: segmentText,
    startWidth: consumedWidth - segmentWidth,
    endWidth: consumedWidth,
  });
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
  if (!composer.text.trim()) {
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
      const cursorDisplayColumn = measureDisplayWidth(logicalLine.slice(0, cursorColumn));

      for (let w = 0; w < wrappedFull.length; w++) {
        const segment = wrappedFull[w]!;
        const segmentStart = segment.startWidth;
        const segmentEnd = segment.endWidth;

        if (cursorDisplayColumn >= segmentStart && cursorDisplayColumn <= segmentEnd) {
          // Cursor is on this visual line
          const localOffset = cursorDisplayColumn - segmentStart;
          const {before, after} = splitAtDisplayWidth(segment.text, localOffset);
          visualCursorLine = renderLines.length;
          renderLines.push({
            beforeCursor: before,
            afterCursor: after,
            isCursorLine: true,
          });
        } else {
          renderLines.push({
            beforeCursor: segment.text,
            afterCursor: '',
            isCursorLine: false,
          });
        }
      }
    } else {
      // Non-cursor line — simple wrap
      const wrapped = softWrapLine(logicalLine, wrapWidth);
      for (const segment of wrapped) {
        renderLines.push({
          beforeCursor: i < logicalCursorLine ? segment.text : '',
          afterCursor: i < logicalCursorLine ? '' : segment.text,
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
  lineLimit?: number,
  placeholder?: string,
  terminalWidth?: number,
): ComposerViewport {
  const availableWidth = (terminalWidth ?? 120) - PREFIX_WIDTH - 2; // 2 for padding
  const wrapWidth = Math.max(MIN_WRAP_WIDTH, availableWidth);
  const {lines, cursorLineIndex} = buildComposerLines(composer, wrapWidth, placeholder);
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

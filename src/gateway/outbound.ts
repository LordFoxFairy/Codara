export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Smart Markdown Chunking
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  /** Max characters per chunk */
  limit: number;
  /** Add continuation markers */
  continuationMarkers?: boolean;
}

/**
 * Split markdown text into chunks that respect structural boundaries:
 * - Code blocks (``` … ```) are kept intact when possible
 * - Lists are kept together when possible
 * - Paragraphs are the primary split boundary
 */
export function chunkMarkdown(text: string, options: ChunkOptions): string[] {
  const {limit, continuationMarkers = false} = options;
  if (text.length <= limit) return [text];

  const blocks = splitIntoBlocks(text);
  const raw = assembleChunks(blocks, limit);

  if (!continuationMarkers || raw.length <= 1) return raw;

  return raw.map((chunk, i) => {
    const isFirst = i === 0;
    const isLast = i === raw.length - 1;
    let result = chunk;
    if (!isFirst) result = '⋯\n' + result;
    if (!isLast) result = result + '\n⋯';
    return result;
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Block {
  text: string;
  kind: 'code' | 'list' | 'paragraph';
}

/** Split text into semantic blocks: code blocks, lists, and paragraphs. */
function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block start
    if (line.trimStart().startsWith('```')) {
      const codeLines = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]!);
        if (lines[i]!.trimStart().startsWith('```') && codeLines.length > 1) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({text: codeLines.join('\n'), kind: 'code'});
      continue;
    }

    // List item (- or * or 1. or 2. etc.)
    if (/^(\s*[-*]|\s*\d+\.)\s/.test(line)) {
      const listLines = [line];
      i++;
      while (i < lines.length && /^(\s*[-*]|\s*\d+\.)\s/.test(lines[i]!)) {
        listLines.push(lines[i]!);
        i++;
      }
      blocks.push({text: listLines.join('\n'), kind: 'list'});
      continue;
    }

    // Empty line — skip (will become paragraph separator)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph — collect consecutive non-empty non-special lines
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trimStart().startsWith('```') &&
      !/^(\s*[-*]|\s*\d+\.)\s/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push({text: paraLines.join('\n'), kind: 'paragraph'});
  }

  return blocks;
}

/** Assemble blocks into chunks respecting the character limit. */
function assembleChunks(blocks: Block[], limit: number): string[] {
  const chunks: string[] = [];
  let current = '';

  function pushCurrent() {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  }

  for (const block of blocks) {
    // Block fits within limit — try appending to current chunk
    if (block.text.length <= limit) {
      const separator = current.length > 0 ? '\n\n' : '';
      if (current.length + separator.length + block.text.length <= limit) {
        current += separator + block.text;
      } else {
        pushCurrent();
        current = block.text;
      }
      continue;
    }

    // Block exceeds limit — must split it
    pushCurrent();

    if (block.kind === 'code') {
      splitCodeBlock(block.text, limit, chunks);
    } else {
      // Split paragraph/list by lines
      splitByLines(block.text, limit, chunks);
    }
  }

  pushCurrent();
  return chunks;
}

/** Split an oversized code block at line boundaries, preserving ``` fences. */
function splitCodeBlock(text: string, limit: number, out: string[]): void {
  const lines = text.split('\n');
  // Extract the opening fence (e.g. ```typescript) and closing fence
  const openFence = lines[0]!;
  const closeFence = lines[lines.length - 1]!.trimStart().startsWith('```') ? lines.pop()! : '```';
  // Remove the opening fence from lines
  lines.shift();

  let current = openFence;
  for (const line of lines) {
    // +1 for newline, + closeFence length for the closing fence we'll add
    const needed = current.length + 1 + line.length + 1 + closeFence.length;
    if (needed > limit && current !== openFence) {
      out.push(current + '\n' + closeFence);
      current = openFence + '\n' + line;
    } else {
      current += '\n' + line;
    }
  }
  out.push(current + '\n' + closeFence);
}

/** Split text by line boundaries when it exceeds the limit. */
function splitByLines(text: string, limit: number, out: string[]): void {
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    const separator = current.length > 0 ? '\n' : '';
    if (current.length + separator.length + line.length <= limit) {
      current += separator + line;
    } else {
      if (current.length > 0) out.push(current);
      // If single line exceeds limit, hard-split it
      if (line.length > limit) {
        const hardChunks = chunkText(line, limit);
        out.push(...hardChunks);
        current = '';
      } else {
        current = line;
      }
    }
  }
  if (current.length > 0) out.push(current);
}

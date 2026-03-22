import React from 'react';
import {Box, Text} from 'ink';

/**
 * Simple terminal markdown renderer for Ink.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, # headings,
 * pipe tables, unordered lists, 1. ordered lists, > blockquotes, --- horizontal rules
 */

interface MarkdownTextProps {
  content: string;
  paddingLeft?: number;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function parseInlineMarkdown(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    // Match **bold**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) segments.push({text: boldMatch[1]});
      segments.push({text: boldMatch[2]!, bold: true});
      remaining = boldMatch[3]!;
      continue;
    }

    // Match *italic* (underscore variant intentionally omitted — too fragile
    // inside identifiers like SOME_CONSTANT_NAME)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+?)\*(.*)/s);
    if (italicMatch) {
      if (italicMatch[1]) segments.push({text: italicMatch[1]});
      segments.push({text: italicMatch[2]!, italic: true});
      remaining = italicMatch[3]!;
      continue;
    }

    // Match `inline code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) segments.push({text: codeMatch[1]});
      segments.push({text: codeMatch[2]!, code: true});
      remaining = codeMatch[3]!;
      continue;
    }

    // No more matches
    segments.push({text: remaining});
    break;
  }

  return segments;
}

function InlineLine({segments}: {segments: InlineSegment[]}): React.JSX.Element {
  return (
    <Text>
      {segments.map((seg, i) => {
        if (seg.bold) return <Text key={i} bold>{seg.text}</Text>;
        if (seg.italic) return <Text key={i} italic>{seg.text}</Text>;
        if (seg.code) return <Text key={i} color="cyan">{seg.text}</Text>;
        return <Text key={i}>{seg.text}</Text>;
      })}
    </Text>
  );
}

interface ParsedBlock {
  kind: 'heading' | 'code' | 'text' | 'list-item' | 'blockquote' | 'hr' | 'table';
  content: string;
  lang?: string;
  level?: number;
  ordered?: boolean;
  bullet?: string;
  header?: string[];
  alignments?: Array<'left' | 'center' | 'right'>;
  bodyRows?: string[][];
}

const TABLE_SEPARATOR_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function isPipeTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return false;
  }

  const segments = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return segments.length >= 2;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function padTableCell(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function renderTableRow(cells: string[], widths: number[]): string {
  return `| ${cells.map((cell, index) => padTableCell(cell, widths[index] ?? 0)).join(' | ')} |`;
}

function renderTableSeparator(widths: number[]): string {
  return `|-${widths.map((width) => '-'.repeat(Math.max(width, 1))).join('-|-')}-|`;
}

function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
  return splitTableRow(line).map((cell) => {
    const trimmed = cell.trim();
    const starts = trimmed.startsWith(':');
    const ends = trimmed.endsWith(':');
    if (starts && ends) {
      return 'center';
    }
    if (ends) {
      return 'right';
    }
    return 'left';
  });
}

function renderHeadingUnderline(content: string, level: number): string | undefined {
  if (level === 1) {
    return '═'.repeat(Math.max(content.length, 3));
  }

  if (level === 2) {
    return '─'.repeat(Math.max(content.length, 3));
  }

  return undefined;
}

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const leadingTrimmedLine = line.trimStart();

    // Code block: ```lang ... ```
    if (leadingTrimmedLine.startsWith('```')) {
      const lang = leadingTrimmedLine.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({kind: 'code', content: codeLines.join('\n'), lang: lang || undefined});
      continue;
    }

    // Heading: # ... ## ... ### ...
    const headingMatch = leadingTrimmedLine.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({kind: 'heading', content: headingMatch[2]!, level: headingMatch[1]!.length});
      i++;
      continue;
    }

    if (
      isPipeTableRow(line)
      && i + 1 < lines.length
      && TABLE_SEPARATOR_PATTERN.test(lines[i + 1]!)
    ) {
      const header = splitTableRow(line);
      const alignments = parseTableAlignments(lines[i + 1]!);
      const bodyRows: string[][] = [];
      i += 2;
      while (i < lines.length && isPipeTableRow(lines[i]!)) {
        bodyRows.push(splitTableRow(lines[i]!));
        i++;
      }
      blocks.push({kind: 'table', content: '', header, alignments, bodyRows});
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}\s*$/.test(leadingTrimmedLine)) {
      blocks.push({kind: 'hr', content: ''});
      i++;
      continue;
    }

    // Unordered list item: - item or * item
    const ulMatch = line.match(/^\s*[*-]\s+(.*)/);
    if (ulMatch) {
      blocks.push({kind: 'list-item', content: ulMatch[1]!, bullet: '•', ordered: false});
      i++;
      continue;
    }

    // Ordered list item: 1. item
    const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
    if (olMatch) {
      blocks.push({kind: 'list-item', content: olMatch[1]!, bullet: `${blocks.filter(b => b.kind === 'list-item' && b.ordered).length + 1}.`, ordered: true});
      i++;
      continue;
    }

    // Blockquote: > text
    const bqMatch = line.match(/^\s*>\s?(.*)/);
    if (bqMatch) {
      blocks.push({kind: 'blockquote', content: bqMatch[1]!});
      i++;
      continue;
    }

    // Regular text line
    blocks.push({kind: 'text', content: line});
    i++;
  }

  return blocks;
}

export function MarkdownText({content, paddingLeft = 0}: MarkdownTextProps): React.JSX.Element {
  const blocks = parseBlocks(content);

  return (
    <Box flexDirection="column" paddingLeft={paddingLeft}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const underline = renderHeadingUnderline(block.content, block.level ?? 1);
          const segments = parseInlineMarkdown(block.content);
          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Text bold><InlineLine segments={segments} /></Text>
              {underline ? <Text dimColor>{underline}</Text> : null}
            </Box>
          );
        }

        if (block.kind === 'code') {
          const codeLines = block.content.split('\n');
          return (
            <Box key={index} flexDirection="column" paddingLeft={2} marginY={0}>
              {codeLines.map((codeLine, ci) => (
                <Text key={ci} color="gray" wrap="truncate-end">{codeLine}</Text>
              ))}
            </Box>
          );
        }

        if (block.kind === 'hr') {
          return <Text key={index} dimColor>{'─'.repeat(40)}</Text>;
        }

        if (block.kind === 'table') {
          const header = block.header ?? [];
          const bodyRows = block.bodyRows ?? [];
          const rows = [header, ...bodyRows];
          const columnCount = Math.max(...rows.map((row) => row.length), 0);
          const widths = Array.from({length: columnCount}, (_, columnIndex) => (
            Math.max(...rows.map((row) => (row[columnIndex] ?? '').length), 1)
          ));
          const normalizedHeader = Array.from({length: columnCount}, (_, columnIndex) => header[columnIndex] ?? '');

          return (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Text bold>{renderTableRow(normalizedHeader, widths)}</Text>
              <Text dimColor>{renderTableSeparator(widths)}</Text>
              {bodyRows.map((row, rowIndex) => (
                <Text key={`table-row-${rowIndex}`}>
                  {renderTableRow(
                    Array.from({length: columnCount}, (_, columnIndex) => row[columnIndex] ?? ''),
                    widths,
                  )}
                </Text>
              ))}
            </Box>
          );
        }

        if (block.kind === 'list-item') {
          const segments = parseInlineMarkdown(block.content);
          return (
            <Box key={index} paddingLeft={2}>
              <Text>{block.bullet} </Text>
              <InlineLine segments={segments} />
            </Box>
          );
        }

        if (block.kind === 'blockquote') {
          const segments = parseInlineMarkdown(block.content);
          return (
            <Box key={index} paddingLeft={1}>
              <Text dimColor>│ </Text>
              <InlineLine segments={segments} />
            </Box>
          );
        }

        // text block - parse inline markdown
        const segments = parseInlineMarkdown(block.content);
        return <InlineLine key={index} segments={segments} />;
      })}
    </Box>
  );
}

import React from 'react';
import {Box, Text} from 'ink';

/**
 * Simple terminal markdown renderer for Ink.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, # headings,
 * - unordered lists, 1. ordered lists, > blockquotes, --- horizontal rules
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
  kind: 'heading' | 'code' | 'text' | 'list-item' | 'blockquote' | 'hr';
  content: string;
  lang?: string;
  level?: number;
  ordered?: boolean;
  bullet?: string;
}

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block: ```lang ... ```
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
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
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({kind: 'heading', content: headingMatch[2]!, level: headingMatch[1]!.length});
      i++;
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({kind: 'hr', content: ''});
      i++;
      continue;
    }

    // Unordered list item: - item or * item
    const ulMatch = line.match(/^(\s*)[*-]\s+(.*)/);
    if (ulMatch) {
      blocks.push({kind: 'list-item', content: ulMatch[2]!, bullet: '•', ordered: false});
      i++;
      continue;
    }

    // Ordered list item: 1. item
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      blocks.push({kind: 'list-item', content: olMatch[2]!, bullet: `${blocks.filter(b => b.kind === 'list-item' && b.ordered).length + 1}.`, ordered: true});
      i++;
      continue;
    }

    // Blockquote: > text
    const bqMatch = line.match(/^>\s?(.*)/);
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
          return (
            <Text key={index} bold>
              {block.content}
            </Text>
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

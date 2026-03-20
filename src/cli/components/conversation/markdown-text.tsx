import React from 'react';
import {Box, Text} from 'ink';

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

interface ParsedBlock {
  kind: 'heading' | 'code' | 'paragraph' | 'list-item' | 'blockquote' | 'hr' | 'blank';
  content: string;
  bullet?: string;
}

function isStandaloneBoldLine(line: string): string | undefined {
  const match = line.match(/^\s*\*\*(.+?)\*\*\s*$/);
  if (!match) {
    return undefined;
  }

  const text = match[1]!.trim();
  return text || undefined;
}

function parseInlineMarkdown(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/s);
    if (boldMatch) {
      if (boldMatch[1]) segments.push({text: boldMatch[1]});
      segments.push({text: boldMatch[2]!, bold: true});
      remaining = boldMatch[3]!;
      continue;
    }

    const italicMatch = remaining.match(/^(.*?)\*([^*]+?)\*(.*)$/s);
    if (italicMatch) {
      if (italicMatch[1]) segments.push({text: italicMatch[1]});
      segments.push({text: italicMatch[2]!, italic: true});
      remaining = italicMatch[3]!;
      continue;
    }

    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/s);
    if (codeMatch) {
      if (codeMatch[1]) segments.push({text: codeMatch[1]});
      segments.push({text: codeMatch[2]!, code: true});
      remaining = codeMatch[3]!;
      continue;
    }

    segments.push({text: remaining});
    break;
  }

  return segments;
}

function InlineLine({segments}: {segments: InlineSegment[]}): React.JSX.Element {
  return (
    <Text>
      {segments.map((segment, index) => {
        if (segment.bold) return <Text key={index} bold>{segment.text}</Text>;
        if (segment.italic) return <Text key={index} italic>{segment.text}</Text>;
        if (segment.code) return <Text key={index} color="cyan">{segment.text}</Text>;
        return <Text key={index}>{segment.text}</Text>;
      })}
    </Text>
  );
}

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const blocks: ParsedBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith('```')) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({kind: 'code', content: codeLines.join('\n')});
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({kind: 'heading', content: headingMatch[2]!});
      index += 1;
      continue;
    }

    const boldHeading = isStandaloneBoldLine(line);
    if (boldHeading) {
      blocks.push({kind: 'heading', content: boldHeading});
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({kind: 'hr', content: ''});
      index += 1;
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (unorderedMatch) {
      const itemLines = [unorderedMatch[1]!.trim()];
      index += 1;
      while (index < lines.length && /^\s{2,}\S/.test(lines[index]!)) {
        itemLines.push(lines[index]!.trim());
        index += 1;
      }
      blocks.push({kind: 'list-item', content: itemLines.join(' '), bullet: '-'});
      continue;
    }

    const orderedMatch = line.match(/^\s*(\d+\.)\s*(.+)/);
    if (orderedMatch) {
      const itemLines = [orderedMatch[2]!.trim()];
      index += 1;
      while (index < lines.length && /^\s{2,}\S/.test(lines[index]!)) {
        itemLines.push(lines[index]!.trim());
        index += 1;
      }
      blocks.push({kind: 'list-item', content: itemLines.join(' '), bullet: orderedMatch[1]!});
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.*)/);
    if (blockquoteMatch) {
      const quoteLines = [blockquoteMatch[1]!.trim()];
      index += 1;
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quoteLines.push(lines[index]!.replace(/^>\s?/, '').trim());
        index += 1;
      }
      blocks.push({kind: 'blockquote', content: quoteLines.join(' ')});
      continue;
    }

    if (!line.trim()) {
      blocks.push({kind: 'blank', content: ''});
      index += 1;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length
      && lines[index]!.trim()
      && !lines[index]!.trimStart().startsWith('```')
      && !/^(#{1,3})\s+/.test(lines[index]!)
      && !/^[-*_]{3,}\s*$/.test(lines[index]!)
      && !/^\s*[-*]\s+/.test(lines[index]!)
      && !/^\s*\d+\.\s+/.test(lines[index]!)
      && !/^>\s?/.test(lines[index]!)
    ) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }

    blocks.push({kind: 'paragraph', content: paragraphLines.join(' ')});
  }

  return blocks;
}

export function MarkdownText({content, paddingLeft = 0}: MarkdownTextProps): React.JSX.Element {
  const blocks = parseBlocks(content);

  return (
    <Box flexDirection="column" paddingLeft={paddingLeft}>
      {blocks.map((block, index) => {
        if (block.kind === 'blank') {
          return <Text key={index}>{' '}</Text>;
        }

        if (block.kind === 'heading') {
          return <Text key={index} bold>{block.content}</Text>;
        }

        if (block.kind === 'code') {
          return (
            <Box key={index} flexDirection="column" paddingLeft={2}>
              {block.content.split('\n').map((codeLine, codeIndex) => (
                <Text key={codeIndex} color="gray" wrap="truncate-end">{codeLine}</Text>
              ))}
            </Box>
          );
        }

        if (block.kind === 'hr') {
          return <Text key={index} dimColor>{'-'.repeat(40)}</Text>;
        }

        if (block.kind === 'list-item') {
          return (
            <Box key={index} paddingLeft={2}>
              <Text>{`${block.bullet} `}</Text>
              <InlineLine segments={parseInlineMarkdown(block.content)} />
            </Box>
          );
        }

        if (block.kind === 'blockquote') {
          return (
            <Box key={index} paddingLeft={1}>
              <Text dimColor>{'> '}</Text>
              <InlineLine segments={parseInlineMarkdown(block.content)} />
            </Box>
          );
        }

        return <InlineLine key={index} segments={parseInlineMarkdown(block.content)} />;
      })}
    </Box>
  );
}

import React from 'react';
import {Box, Text} from 'ink';

/**
 * Simple terminal markdown renderer for Ink.
 * Handles: **bold**, `code`, ```code blocks```, # headings
 */

interface MarkdownTextProps {
  content: string;
  paddingLeft?: number;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
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
        if (seg.code) return <Text key={i} color="cyan">{seg.text}</Text>;
        return <Text key={i}>{seg.text}</Text>;
      })}
    </Text>
  );
}

interface ParsedBlock {
  kind: 'heading' | 'code' | 'text';
  content: string;
  lang?: string;
  level?: number;
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
                <Text key={ci} color="gray">{codeLine}</Text>
              ))}
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

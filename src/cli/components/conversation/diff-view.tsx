import React from 'react';
import {Box, Text} from 'ink';
import type {DiffData} from '../../transcript/diff-compute';
import type {StructuredPatchHunk} from 'diff';

// ── Constants ──────────────────────────────────────────────────────────

const NEW_FILE_PREVIEW_LINES = 20;

// ── React Component ────────────────────────────────────────────────────

interface DiffViewProps {
  diff: DiffData;
}

export function DiffView({diff}: DiffViewProps): React.JSX.Element {
  const {hunks, additions, deletions, isNewFile, truncatedLines} = diff;

  return (
    <Box flexDirection="column">
      {/* Stats */}
      <Box paddingLeft={2}>
        <Text dimColor>{'  '}</Text>
        <Text color="green" bold>{`+${additions}`}</Text>
        <Text dimColor>{' / '}</Text>
        <Text color="red" bold>{`-${deletions}`}</Text>
        {isNewFile ? <Text dimColor>{' (new file)'}</Text> : null}
      </Box>

      {/* Hunks */}
      {hunks.map((hunk, hunkIndex) => (
        <HunkBlock key={hunkIndex} hunk={hunk} isNewFile={isNewFile} />
      ))}

      {/* Truncation notice */}
      {truncatedLines !== undefined && truncatedLines > 0 ? (
        <Box paddingLeft={4}>
          <Text dimColor>{`… showing ${hunks.length} hunks (${truncatedLines} lines hidden)`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function HunkBlock({hunk, isNewFile}: {hunk: StructuredPatchHunk; isNewFile: boolean}): React.JSX.Element {
  const lines = isNewFile ? hunk.lines.slice(0, NEW_FILE_PREVIEW_LINES) : hunk.lines;
  const hiddenNewFileLines = isNewFile && hunk.lines.length > NEW_FILE_PREVIEW_LINES
    ? hunk.lines.length - NEW_FILE_PREVIEW_LINES
    : 0;

  // Compute max line number for alignment
  const maxLineNo = Math.max(
    hunk.oldStart + hunk.oldLines,
    hunk.newStart + hunk.newLines,
  );
  const lineNoWidth = String(maxLineNo).length;

  // Track current line numbers
  let oldLineNo = hunk.oldStart;
  let newLineNo = hunk.newStart;

  const renderedLines = lines.map((line: string, index: number) => {
    const prefix = line.charAt(0);
    const content = line.slice(1);

    let leftNo: string;
    let rightNo: string;

    if (prefix === '+') {
      leftNo = ' '.repeat(lineNoWidth);
      rightNo = String(newLineNo).padStart(lineNoWidth);
      newLineNo++;
    } else if (prefix === '-') {
      leftNo = String(oldLineNo).padStart(lineNoWidth);
      rightNo = ' '.repeat(lineNoWidth);
      oldLineNo++;
    } else {
      leftNo = String(oldLineNo).padStart(lineNoWidth);
      rightNo = String(newLineNo).padStart(lineNoWidth);
      oldLineNo++;
      newLineNo++;
    }

    const lineColor = prefix === '+' ? 'green' : prefix === '-' ? 'red' : undefined;
    const displayPrefix = prefix === '+' ? '+' : prefix === '-' ? '-' : ' ';

    return (
      <Box key={index}>
        <Text dimColor>{`${leftNo} ${rightNo} `}</Text>
        <Text color={lineColor} wrap="truncate-end">{`${displayPrefix}${content}`}</Text>
      </Box>
    );
  });

  return (
    <Box flexDirection="column" paddingLeft={4}>
      <Text color="cyan">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</Text>
      {renderedLines}
      {hiddenNewFileLines > 0 ? (
        <Text dimColor>{`… +${hiddenNewFileLines} lines`}</Text>
      ) : null}
    </Box>
  );
}

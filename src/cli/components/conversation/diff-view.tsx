import React from 'react';
import {Box, Text} from 'ink';

// ── Types ──────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  lineNumber: number;
  content: string;
}

export interface DiffViewProps {
  filePath: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  isNewFile?: boolean;
  truncatedLines?: number;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface ComputedDiff {
  lines: DiffLine[];
  stats: DiffStats;
}

// ── Constants ──────────────────────────────────────────────────────────

const MAX_NEW_FILE_LINES = 20;
const MAX_HUNKS = 5;
const CONTEXT_AROUND_CHANGE = 2;

// ── Pure helpers ───────────────────────────────────────────────────────

/**
 * Compute diff lines from an edit (old_string -> new_string replacement).
 * Uses a simple approach: removed lines followed by added lines, with
 * no external diff library required.
 */
export function computeDiffLines(oldString: string, newString: string): ComputedDiff {
  // New file — everything is an addition
  if (!oldString) {
    return computeNewFileDiff(newString);
  }

  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  // Simple LCS-based diff for small inputs, falling back to
  // sequential remove-then-add for larger ones.
  if (oldLines.length + newLines.length <= 200) {
    return lcsBasedDiff(oldLines, newLines);
  }

  // Fallback: show all old lines as removed, all new lines as added
  let lineNum = 1;
  for (const line of oldLines) {
    lines.push({type: 'remove', lineNumber: lineNum, content: line});
    lineNum++;
    deletions++;
  }
  lineNum = 1;
  for (const line of newLines) {
    lines.push({type: 'add', lineNumber: lineNum, content: line});
    lineNum++;
    additions++;
  }

  return {lines, stats: {additions, deletions}};
}

/**
 * Compute diff lines for a brand-new file (write_file with no prior content).
 */
export function computeNewFileDiff(content: string): ComputedDiff {
  const contentLines = content.split('\n');
  const lines: DiffLine[] = contentLines.map((line, index) => ({
    type: 'add' as const,
    lineNumber: index + 1,
    content: line,
  }));

  return {
    lines,
    stats: {additions: contentLines.length, deletions: 0},
  };
}

/**
 * Minimal LCS diff that produces context / add / remove lines.
 * Suitable for the small inputs typical of edit_file tool calls.
 */
function lcsBasedDiff(oldLines: string[], newLines: string[]): ComputedDiff {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({length: m + 1}, () => Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce edit script
  type EditOp = {kind: 'keep'; old: number; new: number} | {kind: 'remove'; old: number} | {kind: 'add'; new: number};
  const ops: EditOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({kind: 'keep', old: i, new: j});
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({kind: 'add', new: j});
      j--;
    } else {
      ops.push({kind: 'remove', old: i});
      i--;
    }
  }
  ops.reverse();

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  for (const op of ops) {
    switch (op.kind) {
      case 'keep':
        lines.push({type: 'context', lineNumber: op.new, content: newLines[op.new - 1]});
        break;
      case 'remove':
        lines.push({type: 'remove', lineNumber: op.old, content: oldLines[op.old - 1]});
        deletions++;
        break;
      case 'add':
        lines.push({type: 'add', lineNumber: op.new, content: newLines[op.new - 1]});
        additions++;
        break;
    }
  }

  return {lines, stats: {additions, deletions}};
}

/**
 * Collapse a diff into hunks — groups of changes with surrounding context.
 * Returns at most `maxHunks` hunks. If there are more, the trailing ones
 * are replaced by a "... N more changes" sentinel.
 */
export function collapseToHunks(
  allLines: DiffLine[],
  contextSize: number = CONTEXT_AROUND_CHANGE,
  maxHunks: number = MAX_HUNKS,
): DiffLine[] {
  // Mark which indices are "interesting" (non-context) and include surrounding context
  const interesting = new Set<number>();
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].type !== 'context') {
      for (let c = Math.max(0, i - contextSize); c <= Math.min(allLines.length - 1, i + contextSize); c++) {
        interesting.add(c);
      }
    }
  }

  if (interesting.size === 0) {
    return [];
  }

  // Group into contiguous hunks
  const hunks: DiffLine[][] = [];
  let currentHunk: DiffLine[] = [];

  for (let i = 0; i < allLines.length; i++) {
    if (interesting.has(i)) {
      currentHunk.push(allLines[i]);
    } else if (currentHunk.length > 0) {
      hunks.push(currentHunk);
      currentHunk = [];
    }
  }
  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  // Limit hunks
  if (hunks.length <= maxHunks) {
    return hunks.flat();
  }

  const kept = hunks.slice(0, maxHunks).flat();
  const remainingChanges = hunks.slice(maxHunks).flat()
    .filter((l) => l.type !== 'context').length;

  // Add a sentinel context line to indicate truncation
  kept.push({
    type: 'context',
    lineNumber: 0,
    content: `... ${remainingChanges} more change(s)`,
  });

  return kept;
}

// ── React Component ────────────────────────────────────────────────────

export function DiffView({filePath, lines, additions, deletions, isNewFile, truncatedLines}: DiffViewProps): React.JSX.Element {
  const displayLines = isNewFile && lines.length > MAX_NEW_FILE_LINES
    ? lines.slice(0, MAX_NEW_FILE_LINES)
    : collapseToHunks(lines);

  const remainingForNewFile = isNewFile && lines.length > MAX_NEW_FILE_LINES
    ? lines.length - MAX_NEW_FILE_LINES
    : truncatedLines;

  const lineNumWidth = computeLineNumWidth(displayLines);
  const action = isNewFile ? 'Create' : 'Update';

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text color="blueBright" bold>{`● ${action}`}</Text>
        <Text>{`(${filePath})`}</Text>
      </Box>

      {/* Stats */}
      <Box paddingLeft={2}>
        <Text dimColor>└ </Text>
        <DiffStatsLine additions={additions} deletions={deletions} />
      </Box>

      {/* Diff body */}
      {displayLines.length > 0 ? (
        <Box paddingLeft={4} flexDirection="column">
          {displayLines.map((line, index) => (
            <DiffLineRow key={index} line={line} lineNumWidth={lineNumWidth} />
          ))}
        </Box>
      ) : null}

      {/* Truncation notice */}
      {remainingForNewFile && remainingForNewFile > 0 ? (
        <Box paddingLeft={4}>
          <Text color="green" dimColor>{`... +${remainingForNewFile} lines`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function DiffStatsLine({additions, deletions}: DiffStats): React.JSX.Element {
  const parts: React.JSX.Element[] = [];

  if (additions > 0) {
    parts.push(<Text key="add" color="green">{`Added ${additions} line${additions === 1 ? '' : 's'}`}</Text>);
  }
  if (deletions > 0) {
    if (parts.length > 0) {
      parts.push(<Text key="sep" dimColor>{', '}</Text>);
    }
    parts.push(<Text key="del" color="red">{`removed ${deletions} line${deletions === 1 ? '' : 's'}`}</Text>);
  }
  if (parts.length === 0) {
    parts.push(<Text key="none" dimColor>No changes</Text>);
  }

  return <Text>{parts}</Text>;
}

function DiffLineRow({line, lineNumWidth}: {line: DiffLine; lineNumWidth: number}): React.JSX.Element {
  const lineNum = line.lineNumber > 0 ? String(line.lineNumber).padStart(lineNumWidth) : ' '.repeat(lineNumWidth);

  switch (line.type) {
    case 'add':
      return (
        <Text>
          <Text dimColor>{lineNum} </Text>
          <Text color="green">{`+${line.content}`}</Text>
        </Text>
      );
    case 'remove':
      return (
        <Text>
          <Text dimColor>{lineNum} </Text>
          <Text color="red">{`-${line.content}`}</Text>
        </Text>
      );
    case 'context':
      return (
        <Text>
          <Text dimColor>{lineNum} </Text>
          <Text>{` ${line.content}`}</Text>
        </Text>
      );
  }
}

// ── Utilities ──────────────────────────────────────────────────────────

function computeLineNumWidth(lines: DiffLine[]): number {
  let max = 1;
  for (const line of lines) {
    if (line.lineNumber > max) {
      max = line.lineNumber;
    }
  }
  return String(max).length;
}

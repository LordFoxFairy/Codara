import {structuredPatch, type StructuredPatchHunk} from 'diff';
import {readFileSync} from 'node:fs';

export interface DiffData {
  filePath: string;
  hunks: StructuredPatchHunk[];
  additions: number;
  deletions: number;
  isNewFile: boolean;
  truncatedLines?: number;
}

const MAX_DISPLAY_HUNKS = 5;

export function computeEditDiff(filePath: string, oldString: string, newString: string): DiffData | undefined {
  if (!oldString && !newString) return undefined;
  if (isBinaryContent(oldString) || isBinaryContent(newString)) return undefined;

  const patch = structuredPatch(filePath, filePath, oldString, newString, '', '', {context: 3});
  return buildDiffData(filePath, patch.hunks, false);
}

export function computeWriteDiff(filePath: string, newContent: string): DiffData | undefined {
  if (isBinaryContent(newContent)) return undefined;

  let oldContent = '';
  let isNewFile = true;
  try {
    oldContent = readFileSync(filePath, 'utf-8');
    isNewFile = false;
  } catch {
    // file doesn't exist — new file
  }

  const patch = structuredPatch(filePath, filePath, oldContent, newContent, '', '', {context: 3});
  return buildDiffData(filePath, patch.hunks, isNewFile);
}

function buildDiffData(filePath: string, hunks: StructuredPatchHunk[], isNewFile: boolean): DiffData {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
    }
  }

  const displayHunks = hunks.slice(0, MAX_DISPLAY_HUNKS);
  const truncatedLines = hunks.length > MAX_DISPLAY_HUNKS
    ? hunks.slice(MAX_DISPLAY_HUNKS).reduce((sum, h) => sum + h.lines.length, 0)
    : undefined;

  return {filePath, hunks: displayHunks, additions, deletions, isNewFile, truncatedLines};
}

export function isBinaryContent(content: string): boolean {
  return content.includes('\0');
}

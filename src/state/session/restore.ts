/**
 * Session restore from JSONL transcript.
 *
 * Used as a fallback when checkpoint-based restore fails (e.g. corrupted
 * checkpoint file). Reads the transcript, finds the last compact boundary,
 * and returns only the entries after it -- giving the session a clean
 * starting point without replaying the entire history.
 *
 * @module
 */

import {TranscriptReader} from './transcript';
import type {TranscriptEntry} from './types';

export interface RestoredSession {
  entries: TranscriptEntry[];
  metadata: {
    messageCount: number;
    lastTimestamp: number | undefined;
    /** True when a compact boundary was found and older entries were skipped. */
    hasCompactBoundary: boolean;
  };
}

/**
 * Restore session state from a JSONL transcript file.
 *
 * Reads all entries once, identifies the last compact boundary, filters
 * ephemeral entries, and returns the result with metadata.
 */
export async function restoreSession(transcriptPath: string): Promise<RestoredSession> {
  const reader = new TranscriptReader(transcriptPath);

  // Single read -- avoid the double-read that readFromLastBoundary + readAll would cause.
  const allEntries = await reader.readAll();

  // Find last compact boundary
  let boundaryIdx = -1;
  for (let i = allEntries.length - 1; i >= 0; i--) {
    if (allEntries[i].metadata?.subtype === 'compact_boundary') {
      boundaryIdx = i;
      break;
    }
  }

  const postBoundary = boundaryIdx >= 0 ? allEntries.slice(boundaryIdx + 1) : allEntries;
  const filtered = postBoundary.filter((e) => !isEphemeral(e));

  return {
    entries: filtered,
    metadata: {
      messageCount: filtered.length,
      lastTimestamp: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : undefined,
      hasCompactBoundary: boundaryIdx >= 0,
    },
  };
}

function isEphemeral(entry: TranscriptEntry): boolean {
  return entry.metadata?.subtype === 'progress' ||
         entry.metadata?.subtype === 'ephemeral';
}

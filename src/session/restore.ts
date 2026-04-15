/** @future — Session restore from JSONL transcript. Not yet integrated; checkpoint system handles current restore needs. */
import {TranscriptReader} from './transcript';
import type {TranscriptEntry} from './types';

export interface RestoredSession {
  entries: TranscriptEntry[];
  metadata: {
    messageCount: number;
    lastTimestamp: number | undefined;
    hasCompactBoundary: boolean;
  };
}

export async function restoreSession(transcriptPath: string): Promise<RestoredSession> {
  const reader = new TranscriptReader(transcriptPath);

  // Read from last compact boundary if it exists
  const entries = await reader.readFromLastBoundary();

  // Filter out ephemeral entries
  const filtered = entries.filter(e => !isEphemeral(e));

  return {
    entries: filtered,
    metadata: {
      messageCount: filtered.length,
      lastTimestamp: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : undefined,
      hasCompactBoundary: entries.length < (await reader.readAll()).length,
    },
  };
}

function isEphemeral(entry: TranscriptEntry): boolean {
  // Progress entries, ephemeral UI state, etc.
  return entry.metadata?.subtype === 'progress' ||
         entry.metadata?.subtype === 'ephemeral';
}

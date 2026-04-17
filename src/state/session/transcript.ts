/**
 * JSONL transcript I/O.
 *
 * {@link TranscriptWriter} appends entries with a coalescing buffer (similar to
 * Claude Code's `pendingEntries` + `flushPromptHistory` pattern in `history.ts`)
 * to reduce disk I/O during streaming.
 *
 * {@link TranscriptReader} supports:
 * - Full scan (`readAll`)
 * - Tail-only scan (`readTail`) for large files
 * - Compact-boundary-aware scan (`readFromLastBoundary`) for session restore
 *
 * @module
 */

import {appendFile, mkdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {TranscriptEntry} from './types';

/**
 * Buffered JSONL writer. Entries are coalesced and flushed after a short
 * interval to avoid one syscall per streamed token. Call `close()` or
 * `flush()` explicitly before process exit.
 */
export class TranscriptWriter {
  private readonly filePath: string;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly flushInterval: number;

  constructor(options: {filePath: string; flushInterval?: number}) {
    this.filePath = options.filePath;
    this.flushInterval = options.flushInterval ?? 100;
  }

  async append(entry: TranscriptEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    this.buffer.push(line);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  async appendImmediate(entry: TranscriptEntry): Promise<void> {
    await this.flush();
    const line = JSON.stringify(entry) + '\n';
    await this.ensureDir();
    await appendFile(this.filePath, line, 'utf8');
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.buffer.length === 0) return;

    const data = this.buffer.join('');
    this.buffer = [];
    await this.ensureDir();
    await appendFile(this.filePath, data, 'utf8');
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private dirEnsured = false;
  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await mkdir(path.dirname(this.filePath), {recursive: true});
    this.dirEnsured = true;
  }
}

/**
 * JSONL transcript reader with tail-scan and compact-boundary support.
 *
 * Corrupted lines (partial writes from crashes) are silently skipped --
 * the append-only JSONL format guarantees only the last line can be partial.
 */
export class TranscriptReader {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async readAll(): Promise<TranscriptEntry[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }

    const entries: TranscriptEntry[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as TranscriptEntry);
      } catch {
        // Skip corrupted lines — append-only JSONL guarantees only last line can be partial
        continue;
      }
    }
    return entries;
  }

  async readTail(maxBytes: number = 10_000_000): Promise<TranscriptEntry[]> {
    let fileSize: number;
    try {
      fileSize = (await stat(this.filePath)).size;
    } catch {
      return [];
    }

    if (fileSize <= maxBytes) {
      return this.readAll();
    }

    // Read from offset
    const fs = await import('node:fs');
    const fd = await fs.promises.open(this.filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      await fd.read(buffer, 0, maxBytes, fileSize - maxBytes);
      const content = buffer.toString('utf8');
      // Skip first potentially partial line
      const firstNewline = content.indexOf('\n');
      const usable = firstNewline >= 0 ? content.slice(firstNewline + 1) : content;

      const entries: TranscriptEntry[] = [];
      for (const line of usable.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as TranscriptEntry);
        } catch {
          continue;
        }
      }
      return entries;
    } finally {
      await fd.close();
    }
  }

  /** Find last compact boundary and return only entries after it */
  async readFromLastBoundary(): Promise<TranscriptEntry[]> {
    const entries = await this.readAll();
    let boundaryIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].metadata?.subtype === 'compact_boundary') {
        boundaryIdx = i;
        break;
      }
    }
    return boundaryIdx >= 0 ? entries.slice(boundaryIdx + 1) : entries;
  }
}

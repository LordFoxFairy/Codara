import {watch, type FSWatcher} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';

/**
 * Settings file change detector.
 *
 * Pattern reference: Claude Code changeDetector.ts — chokidar-based watcher
 * with deletion grace period, internal write suppression, and centralized
 * cache reset before listener notification.
 *
 * Our simplified version uses node:fs.watch (adequate for settings files)
 * but implements the same key patterns:
 *   - Internal write suppression (prevent self-echo)
 *   - Debounced change notification (avoid partial-write triggers)
 *   - Deletion grace period (absorb delete-and-recreate patterns)
 *   - Per-path tracking (know which source changed)
 */

/** Time to wait for writes to stabilize before processing. */
const STABILITY_THRESHOLD_MS = 1000;

/**
 * Grace period for deletions. If the file reappears within this window,
 * the deletion is cancelled and treated as a change instead.
 * Must exceed STABILITY_THRESHOLD_MS so recreated files settle first.
 */
const DELETION_GRACE_MS = 1500;

/**
 * Window during which a file change is assumed to be our own write
 * and suppressed. Matches Claude Code's INTERNAL_WRITE_WINDOW_MS.
 */
const INTERNAL_WRITE_WINDOW_MS = 5000;

export interface SettingsWatcherOptions {
  watchPaths: string[];
  onChange: (changedPath: string) => void;
  stabilityThreshold?: number;
}

export class SettingsWatcher {
  private watchers: FSWatcher[] = [];
  private changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private internalWrites = new Map<string, number>();
  private readonly options: Required<SettingsWatcherOptions>;

  constructor(options: SettingsWatcherOptions) {
    this.options = {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      ...options,
    };
  }

  async start(): Promise<void> {
    for (const watchPath of this.options.watchPaths) {
      try {
        // Watch the directory containing the settings file, not the file itself.
        // This lets us detect file creation (the file may not exist at start).
        const dir = path.dirname(watchPath);
        const fileName = path.basename(watchPath);

        const watcher = watch(dir, (eventType, changedFile) => {
          if (changedFile === fileName) {
            this.handleFileEvent(watchPath, eventType);
          }
        });
        this.watchers.push(watcher);
      } catch {
        // Directory doesn't exist — acceptable for settings that haven't been created yet.
      }
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.changeTimers.values()) clearTimeout(timer);
    for (const timer of this.deletionTimers.values()) clearTimeout(timer);
    this.changeTimers.clear();
    this.deletionTimers.clear();
    this.internalWrites.clear();
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  /**
   * Mark that we're about to write to a settings file.
   * The watcher will suppress the next change event for this path
   * within INTERNAL_WRITE_WINDOW_MS.
   */
  markInternalWrite(filePath?: string): void {
    if (filePath) {
      this.internalWrites.set(filePath, Date.now());
    } else {
      // Legacy: suppress all paths for backward compatibility.
      for (const p of this.options.watchPaths) {
        this.internalWrites.set(p, Date.now());
      }
    }
  }

  private handleFileEvent(filePath: string, eventType: string): void {
    // Suppress self-echoes.
    if (this.consumeInternalWrite(filePath)) return;

    if (eventType === 'rename') {
      // 'rename' fires on both creation and deletion.
      // Check if the file still exists to distinguish.
      void this.handlePossibleDeletion(filePath);
    } else {
      // 'change' — file content modified.
      this.cancelDeletion(filePath);
      this.scheduleChange(filePath);
    }
  }

  private async handlePossibleDeletion(filePath: string): Promise<void> {
    try {
      const s = await stat(filePath);
      if (s.isFile()) {
        // File exists — this was a creation or rename-to, treat as change.
        this.cancelDeletion(filePath);
        this.scheduleChange(filePath);
      }
    } catch {
      // File gone — schedule a deletion with grace period.
      this.scheduleDeletion(filePath);
    }
  }

  private scheduleChange(filePath: string): void {
    // Debounce: wait for writes to stabilize.
    const existing = this.changeTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this.changeTimers.set(filePath, setTimeout(() => {
      this.changeTimers.delete(filePath);
      this.options.onChange(filePath);
    }, this.options.stabilityThreshold));
  }

  /**
   * Schedule a delayed deletion notification. If the file reappears
   * within DELETION_GRACE_MS (delete-and-recreate pattern), the
   * deletion is cancelled and treated as a change.
   */
  private scheduleDeletion(filePath: string): void {
    if (this.deletionTimers.has(filePath)) return;

    this.deletionTimers.set(filePath, setTimeout(() => {
      this.deletionTimers.delete(filePath);
      this.options.onChange(filePath);
    }, DELETION_GRACE_MS));
  }

  private cancelDeletion(filePath: string): void {
    const timer = this.deletionTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.deletionTimers.delete(filePath);
    }
  }

  /**
   * If the path was marked as an internal write within the window,
   * consume the mark and return true (suppress the event).
   */
  private consumeInternalWrite(filePath: string): boolean {
    const ts = this.internalWrites.get(filePath);
    if (ts !== undefined && Date.now() - ts < INTERNAL_WRITE_WINDOW_MS) {
      this.internalWrites.delete(filePath);
      return true;
    }
    return false;
  }
}

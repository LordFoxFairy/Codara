import {watch, type FSWatcher} from 'node:fs';

export interface SettingsWatcherOptions {
  watchPaths: string[];
  onChange: () => void;
  stabilityThreshold?: number;
}

export class SettingsWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private internalWriteUntil = 0;
  private readonly options: Required<SettingsWatcherOptions>;

  constructor(options: SettingsWatcherOptions) {
    this.options = {stabilityThreshold: 1000, ...options};
  }

  async start(): Promise<void> {
    for (const watchPath of this.options.watchPaths) {
      try {
        const watcher = watch(watchPath, () => this.onFileChange());
        this.watchers.push(watcher);
      } catch {
        // File doesn't exist yet
      }
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  markInternalWrite(): void {
    this.internalWriteUntil = Date.now() + 5000;
  }

  private onFileChange(): void {
    if (Date.now() < this.internalWriteUntil) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.options.onChange();
    }, this.options.stabilityThreshold);
  }
}

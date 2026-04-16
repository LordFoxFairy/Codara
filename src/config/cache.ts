import {loadCodaraSettings, type LoadSettingsOptions} from '@config/loader';
import type {CodaraSettings} from '@config/schema';

/**
 * Reactive settings cache with automatic reload on invalidation.
 *
 * Pattern reference: Claude Code settingsCache.ts — centralized cache with
 * resetSettingsCache() clearing all layers. Our addition: auto-reload after
 * invalidation so listeners always receive the NEW settings, not stale data.
 *
 * Lifecycle:
 *   get() → cache hit / load from disk → return settings
 *   invalidate() → clear cache → reload from disk → notify listeners with NEW settings
 *   onChange() → subscribe to post-reload notifications
 */
export class SettingsCache {
  private cached: CodaraSettings | undefined;
  private loading: Promise<CodaraSettings> | undefined;
  private listeners = new Set<(settings: CodaraSettings) => void>();
  private readonly options: LoadSettingsOptions;

  constructor(options: LoadSettingsOptions) {
    this.options = options;
  }

  /** Get current settings. Loads from disk on first call, then cached. */
  async get(): Promise<CodaraSettings> {
    if (this.cached) return this.cached;
    if (this.loading) return this.loading;
    this.loading = this.load();
    return this.loading;
  }

  /**
   * Invalidate cache and reload from disk.
   * Listeners are notified with the NEW settings after reload completes.
   * If reload fails, listeners receive an empty settings object.
   */
  async invalidate(): Promise<void> {
    this.cached = undefined;
    this.loading = undefined;

    let fresh: CodaraSettings;
    try {
      fresh = await this.load();
    } catch {
      fresh = {} as CodaraSettings;
    }

    for (const listener of this.listeners) {
      try {
        listener(fresh);
      } catch {
        // Listeners must not break the invalidation chain.
      }
    }
  }

  /**
   * Synchronous invalidation — clears cache without reloading.
   * Use when you need to force a fresh load on next get() but don't need notifications.
   */
  reset(): void {
    this.cached = undefined;
    this.loading = undefined;
  }

  /** Subscribe to settings change notifications. Returns unsubscribe function. */
  onChange(listener: (settings: CodaraSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Peek at cached settings without triggering a load. */
  peek(): CodaraSettings | undefined {
    return this.cached;
  }

  private async load(): Promise<CodaraSettings> {
    const settings = await loadCodaraSettings(this.options);
    this.cached = settings;
    this.loading = undefined;
    return settings;
  }
}

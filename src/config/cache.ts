import {loadCodaraSettings, type LoadSettingsOptions} from '@config/loader';
import type {CodaraSettings} from '@config/schema';

export class SettingsCache {
  private cached: CodaraSettings | undefined;
  private loading: Promise<CodaraSettings> | undefined;
  private listeners = new Set<(settings: CodaraSettings) => void>();
  private readonly options: LoadSettingsOptions;

  constructor(options: LoadSettingsOptions) {
    this.options = options;
  }

  async get(): Promise<CodaraSettings> {
    if (this.cached) return this.cached;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const settings = await loadCodaraSettings(this.options);
      this.cached = settings;
      this.loading = undefined;
      return settings;
    })();
    return this.loading;
  }

  invalidate(): void {
    const prev = this.cached;
    this.cached = undefined;
    this.loading = undefined;
    for (const listener of this.listeners) {
      listener(prev ?? ({} as CodaraSettings));
    }
  }

  onChange(listener: (settings: CodaraSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  peek(): CodaraSettings | undefined {
    return this.cached;
  }
}

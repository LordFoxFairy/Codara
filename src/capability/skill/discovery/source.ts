import type {
  SkillStore,
  SkillsRuntimeData,
  SkillsSource,
} from '@capability/skill/contracts';
import {loadSkillsRuntimeData} from '@capability/skill/runtime/runtime';

export interface FileSkillsSourceOptions {
  loadRuntime: () => Promise<SkillsRuntimeData>;
  reload?: () => void;
}

export interface CodaraSkillsSourceOptions {
  store: SkillStore;
  subagentRoots?: string[];
}

/**
 * Session-scoped skills runtime source.
 *
 * It owns:
 * - session-lifetime cached runtime projection
 * - explicit reload invalidation
 * - separating skills discovery from middleware prompt projection
 */
export class FileSkillsSource implements SkillsSource {
  private cache?: SkillsRuntimeData;
  private inflight?: Promise<SkillsRuntimeData>;

  constructor(private readonly options: FileSkillsSourceOptions) {}

  async getRuntime(): Promise<SkillsRuntimeData> {
    if (this.cache) {
      return this.cache;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = (async () => {
      try {
        const runtime = await this.options.loadRuntime();
        this.cache = runtime;
        return runtime;
      } finally {
        this.inflight = undefined;
      }
    })();

    return this.inflight;
  }

  reload(): void {
    this.options.reload?.();
    this.cache = undefined;
    this.inflight = undefined;
  }
}

export function createCodaraSkillsSource(options: CodaraSkillsSourceOptions): SkillsSource {
  return new FileSkillsSource({
    loadRuntime: () => loadSkillsRuntimeData(options.store, options.subagentRoots ?? []),
    reload: () => options.store.refresh?.(),
  });
}

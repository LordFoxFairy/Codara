import type {SkillsRuntimeData, SkillStore, SkillsSource} from '@infra/context/skills/contracts';
import {loadSkillsRuntimeData} from '@capability/skill/runtime/runtime';

// Re-export from infra for backwards compatibility
export type {SkillsSource} from '@infra/context/skills/contracts';

export interface FileSkillsSourceOptions {
  load: () => Promise<SkillsRuntimeData>;
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

    this.inflight = this.options.load()
      .then((runtime) => {
        this.cache = runtime;
        return runtime;
      })
      .finally(() => {
        this.inflight = undefined;
      });

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
    load: () => loadSkillsRuntimeData(options.store, options.subagentRoots ?? []),
    reload: () => options.store.refresh?.(),
  });
}

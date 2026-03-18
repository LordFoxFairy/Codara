import {readFileSync, existsSync} from 'fs';
import {z} from 'zod';
import {
  type HookEventType,
  type HookSource,
  type HookEntry,
  type HookDefinition,
  type HookMatcher,
  HOOK_EVENT_TYPES,
  hookDefinitionSchema,
  hookSourcePriority,
} from '@observability/hook/types';

// Lenient config schema: accepts the structure but doesn't validate individual hook definitions,
// so we can skip invalid ones instead of rejecting the whole file.
const lenientConfigSchema = z.object({
  description: z.string().optional(),
  hooks: z.record(
    z.enum(HOOK_EVENT_TYPES as unknown as [string, ...string[]]),
    z.array(z.object({hooks: z.array(z.unknown())})).optional(),
  ).optional().default({}),
});

export interface HookRegistry {
  load(sources: HookSource[]): Promise<void>;
  reload(): Promise<void>;
  getHooks(eventType: HookEventType): readonly HookEntry[];
  getMatchedHooks(eventType: HookEventType, filter: {
    toolName?: string;
    commandText?: string;
  }): readonly HookEntry[];
  readonly size: number;
}

export class HookRegistryImpl implements HookRegistry {
  private index = new Map<HookEventType, HookEntry[]>();
  private sources: HookSource[] = [];
  private totalCount = 0;

  get size(): number {
    return this.totalCount;
  }

  async load(sources: HookSource[]): Promise<void> {
    this.sources = sources;
    this.index.clear();
    this.totalCount = 0;

    for (const source of sources) {
      const config = this.loadConfigFromSource(source);
      if (!config) continue;

      const priority = hookSourcePriority(source);

      for (const [eventTypeStr, groups] of Object.entries(config.hooks)) {
        const eventType = eventTypeStr as HookEventType;
        if (!HOOK_EVENT_TYPES.includes(eventType)) continue;

        for (const group of groups ?? []) {
          for (const rawHook of group.hooks) {
            const parsed = hookDefinitionSchema.safeParse(rawHook);
            if (!parsed.success) {
              console.warn(`[hooks] Skipping invalid hook definition in ${source.path}:`, parsed.error.message);
              continue;
            }
            this.addEntry(eventType, parsed.data, source, priority);
          }
        }
      }
    }

    // Stable sort by priority descending within each eventType
    for (const entries of this.index.values()) {
      entries.sort((a, b) => b.priority - a.priority);
    }
  }

  async reload(): Promise<void> {
    await this.load(this.sources);
  }

  getHooks(eventType: HookEventType): readonly HookEntry[] {
    return this.index.get(eventType) ?? [];
  }

  getMatchedHooks(
    eventType: HookEventType,
    filter: {toolName?: string; commandText?: string},
  ): readonly HookEntry[] {
    const all = this.getHooks(eventType);
    if (!filter.toolName && !filter.commandText) return all;

    return all.filter((entry) => this.matchesFilter(entry.definition.matcher, filter));
  }

  // ── Private ──

  private addEntry(
    eventType: HookEventType,
    definition: HookDefinition,
    source: HookSource,
    priority: number,
  ): void {
    let entries = this.index.get(eventType);
    if (!entries) {
      entries = [];
      this.index.set(eventType, entries);
    }
    entries.push({definition, eventType, source, priority});
    this.totalCount++;
  }

  private matchesFilter(
    matcher: HookMatcher | undefined,
    filter: {toolName?: string; commandText?: string},
  ): boolean {
    if (!matcher) return true; // no matcher = match all

    if (matcher.toolName) {
      const names = Array.isArray(matcher.toolName) ? matcher.toolName : [matcher.toolName];
      if (filter.toolName && !names.includes(filter.toolName)) return false;
    }

    if (matcher.commandPattern && filter.commandText) {
      try {
        if (!new RegExp(matcher.commandPattern).test(filter.commandText)) return false;
      } catch {
        return false; // invalid regex = no match
      }
    }

    return true;
  }

  private loadConfigFromSource(source: HookSource): z.infer<typeof lenientConfigSchema> | null {
    try {
      if (!existsSync(source.path)) return null;
      const raw = readFileSync(source.path, 'utf-8');
      const json = JSON.parse(raw);
      const result = lenientConfigSchema.safeParse(json);
      if (!result.success) {
        console.warn(`[hooks] Invalid config in ${source.path}:`, result.error.message);
        return null;
      }
      return result.data;
    } catch {
      return null;
    }
  }
}

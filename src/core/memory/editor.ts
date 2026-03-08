import {createMemoryStore} from '@core/memory/store';
import type {
  MemoryEntries,
  MemoryEntry,
  MemoryEntryKind,
  MemoryEditResult,
  MemoryScope,
  MemorySourceOptions,
} from '@core/memory/types';

const MANAGED_HEADING = '## Codara Memory';
const SECTION_HEADINGS: Record<MemoryEntryKind, string> = {
  preference: '### Preferences',
  fact: '### Facts',
  lesson: '### Lessons',
};

const EMPTY_MEMORY_ENTRIES: MemoryEntries = {
  preference: [],
  fact: [],
  lesson: [],
};

export interface MemoryEditor {
  snapshot(scope: MemoryScope): Promise<MemoryEntries>;
  remember(scope: MemoryScope, entry: MemoryEntry): Promise<MemoryEditResult>;
  forget(scope: MemoryScope, entry: MemoryEntry): Promise<MemoryEditResult>;
}

/** 创建 MEMORY.md 的受控编辑接口。 */
export function createMemoryEditor(options: MemorySourceOptions = {}): MemoryEditor {
  const store = createMemoryStore(options);

  return {
    async snapshot(scope) {
      const current = (await store.read(scope)) ?? '';
      return parseManagedMemory(current).entries;
    },

    async remember(scope, entry) {
      return updateManagedMemory(store, scope, entry, 'remember');
    },

    async forget(scope, entry) {
      return updateManagedMemory(store, scope, entry, 'forget');
    },
  };
}

type MemoryEditMode = 'remember' | 'forget';

interface ManagedMemoryState {
  prefix: string;
  entries: MemoryEntries;
}

function updateManagedMemory(
  store: ReturnType<typeof createMemoryStore>,
  scope: MemoryScope,
  entry: MemoryEntry,
  mode: MemoryEditMode
): Promise<MemoryEditResult> {
  return (async () => {
    const content = normalizeEntryContent(entry.content);
    const current = (await store.read(scope)) ?? '';
    const state = parseManagedMemory(current);
    const section = state.entries[entry.kind];
    const hasEntry = section.includes(content);

    if (mode === 'remember' && !hasEntry) {
      section.push(content);
    }

    if (mode === 'forget' && hasEntry) {
      state.entries[entry.kind] = section.filter((item) => item !== content);
    }

    const nextContent = renderManagedMemory(state);
    await store.write(scope, nextContent);

    return {
      scope,
      path: store.resolve(scope),
      changed: mode === 'remember' ? !hasEntry : hasEntry,
      content: nextContent,
      entries: cloneMemoryEntries(state.entries),
    };
  })();
}

function parseManagedMemory(current: string): ManagedMemoryState {
  const normalized = current.trim();
  const headingMatch = normalized.match(/(^|\n)## Codara Memory\b/);
  const headingIndex = headingMatch ? headingMatch.index! + headingMatch[1].length : -1;
  const prefix = headingIndex >= 0 ? normalized.slice(0, headingIndex).trimEnd() : normalized;
  const managed = headingIndex >= 0 ? normalized.slice(headingIndex) : '';

  return {
    prefix,
    entries: {
      preference: parseSectionEntries(managed, SECTION_HEADINGS.preference),
      fact: parseSectionEntries(managed, SECTION_HEADINGS.fact),
      lesson: parseSectionEntries(managed, SECTION_HEADINGS.lesson),
    },
  };
}

function parseSectionEntries(block: string, heading: string): string[] {
  if (!block) {
    return [];
  }

  const lines = block.split('\n');
  const entries: string[] = [];
  let capture = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      capture = line.trim() === heading;
      continue;
    }

    if (!capture) {
      continue;
    }

    if (line.startsWith('- ')) {
      entries.push(line.slice(2).trim());
    }
  }

  return entries;
}

function renderManagedMemory(state: ManagedMemoryState): string {
  const sections = Object.entries(SECTION_HEADINGS)
    .map(([kind, heading]) => {
      const entries = state.entries[kind as MemoryEntryKind];
      if (entries.length === 0) {
        return undefined;
      }

      return [heading, ...entries.map((entry) => `- ${entry}`)].join('\n');
    })
    .filter((section): section is string => Boolean(section));

  const parts = [];
  if (state.prefix) {
    parts.push(state.prefix);
  }

  if (sections.length > 0) {
    parts.push([MANAGED_HEADING, ...sections].join('\n\n'));
  }

  return parts.join('\n\n').trim();
}

function normalizeEntryContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error('Memory entry content cannot be empty.');
  }

  return normalized.replace(/\s+/g, ' ');
}

function cloneMemoryEntries(entries: MemoryEntries): MemoryEntries {
  return {
    preference: [...entries.preference],
    fact: [...entries.fact],
    lesson: [...entries.lesson],
  };
}

export const EMPTY_MANAGED_MEMORY: MemoryEntries = cloneMemoryEntries(EMPTY_MEMORY_ENTRIES);

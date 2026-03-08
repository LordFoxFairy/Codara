import {createMemoryStore} from '@core/memory/store';
import type {
  MemoryEntryKind,
  MemoryScope,
  MemorySourceOptions,
  MemoryWriteEntry,
  MemoryWriteResult,
} from '@core/memory/types';

const MANAGED_HEADING = '## Codara Memory';
const SECTION_HEADINGS: Record<MemoryEntryKind, string> = {
  preference: '### Preferences',
  fact: '### Facts',
  lesson: '### Lessons',
};

export interface MemoryWriter {
  remember(scope: MemoryScope, entry: MemoryWriteEntry): Promise<MemoryWriteResult>;
}

/** 创建 MEMORY.md 的最小写回接口。 */
export function createMemoryWriter(options: MemorySourceOptions = {}): MemoryWriter {
  const store = createMemoryStore(options);

  return {
    async remember(scope, entry) {
      const content = normalizeEntryContent(entry.content);
      const current = (await store.read(scope)) ?? '';
      const next = applyMemoryEntry(current, {
        kind: entry.kind,
        content,
      });

      await store.write(scope, next.content);

      return {
        scope,
        path: store.resolve(scope),
        added: next.added,
        content: next.content,
      };
    },
  };
}

interface ManagedMemoryState {
  prefix: string;
  entries: Record<MemoryEntryKind, string[]>;
}

interface AppliedMemoryEntry {
  added: boolean;
  content: string;
}

function applyMemoryEntry(current: string, entry: MemoryWriteEntry): AppliedMemoryEntry {
  const state = parseManagedMemory(current);
  const section = state.entries[entry.kind];

  if (section.includes(entry.content)) {
    return {
      added: false,
      content: renderManagedMemory(state),
    };
  }

  section.push(entry.content);

  return {
    added: true,
    content: renderManagedMemory(state),
  };
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

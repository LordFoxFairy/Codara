/** MEMORY.md 的来源文件。 */
export interface MemoryFile {
  scope: 'global' | 'project';
  path: string;
}

export type MemoryScope = 'global' | 'project';

/** 已加载的 MEMORY.md 结果。 */
export interface LoadedMemory {
  files: MemoryFile[];
  content: string;
}

/** MEMORY.md 来源定位选项。 */
export interface MemorySourceOptions {
  cwd?: string;
  userHome?: string;
  projectRoot?: string;
}

/** MEMORY.md 加载与注入选项。 */
export interface MemoryLoadOptions extends MemorySourceOptions {
  maxChars?: number;
}

export type MemoryEntryKind = 'preference' | 'fact' | 'lesson';

export type MemoryEntries = Record<MemoryEntryKind, string[]>;

/** 可写入 MEMORY.md 的长期记忆条目。 */
export interface MemoryEntry {
  kind: MemoryEntryKind;
  content: string;
}

/** MEMORY.md 编辑结果。 */
export interface MemoryEditResult {
  scope: MemoryScope;
  path: string;
  added: boolean;
  content: string;
  entries: MemoryEntries;
}

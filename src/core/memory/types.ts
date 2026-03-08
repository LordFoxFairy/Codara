/** MEMORY.md 的来源文件。 */
export interface MemoryFile {
  scope: 'global' | 'project';
  path: string;
}

/** 已加载的 MEMORY.md 结果。 */
export interface LoadedMemory {
  files: MemoryFile[];
  content: string;
}

/** MEMORY.md 加载选项。 */
export interface MemoryOptions {
  userHome?: string;
  projectRoot?: string;
  maxChars?: number;
}

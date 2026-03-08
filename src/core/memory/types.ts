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

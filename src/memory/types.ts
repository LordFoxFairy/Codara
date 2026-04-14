export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryFile {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

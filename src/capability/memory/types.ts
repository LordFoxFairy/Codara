export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryFile {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

/**
 * Sanitize a memory name into a safe filename segment.
 * Shared by MemoryReader and MemoryWriter.
 */
export function sanitizeMemoryFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Memory topic 文件自动驱逐策略。
 *
 * 按 mtime 排序，oldest-first 驱逐，直到满足 maxFiles 和 maxTotalBytes 限制。
 * MEMORY.md（索引文件）永远不会被驱逐。
 */

import {readdir, stat, unlink} from 'node:fs/promises';
import path from 'node:path';

const MEMORY_INDEX_FILE = 'MEMORY.md';

export interface EvictionPolicy {
  /** 最大 topic 文件数（不含 MEMORY.md）。 */
  maxFiles: number;
  /** 所有 topic 文件总字节上限（不含 MEMORY.md）。 */
  maxTotalBytes: number;
}

export const DEFAULT_EVICTION_POLICY: EvictionPolicy = {
  maxFiles: 50,
  maxTotalBytes: 512 * 1024, // 512 KB
};

interface FileEntry {
  name: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
}

export async function evictMemoryFiles(
  dir: string,
  policy: EvictionPolicy = DEFAULT_EVICTION_POLICY,
): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }

  const mdFiles = names.filter(
    (name) => name.endsWith('.md') && name !== MEMORY_INDEX_FILE,
  );

  // Collect file stats
  const entries: FileEntry[] = [];
  for (const name of mdFiles) {
    const fullPath = path.join(dir, name);
    try {
      const s = await stat(fullPath);
      entries.push({name, fullPath, size: s.size, mtimeMs: s.mtimeMs});
    } catch {
      // skip unreadable files
    }
  }

  // Sort oldest first (lowest mtimeMs first)
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

  // Determine which files to evict
  const toEvict = new Set<string>();

  // 1. Evict by count (remove oldest until within limit)
  if (entries.length > policy.maxFiles) {
    const excess = entries.length - policy.maxFiles;
    for (let i = 0; i < excess; i++) {
      toEvict.add(entries[i].fullPath);
    }
  }

  // 2. Evict by total size (remove oldest until within limit)
  const surviving = entries.filter((e) => !toEvict.has(e.fullPath));
  let totalSize = surviving.reduce((sum, e) => sum + e.size, 0);
  // Walk oldest-first among survivors
  for (const entry of surviving) {
    if (totalSize <= policy.maxTotalBytes) {
      break;
    }
    toEvict.add(entry.fullPath);
    totalSize -= entry.size;
  }

  // Perform eviction
  let evicted = 0;
  for (const fullPath of toEvict) {
    try {
      await unlink(fullPath);
      evicted++;
    } catch {
      // best-effort
    }
  }

  return evicted;
}

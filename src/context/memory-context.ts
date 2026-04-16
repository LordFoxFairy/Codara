import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

export interface MemoryEntry {
  name: string;
  type: 'user' | 'feedback' | 'project' | 'reference' | 'unknown';
  content: string;
  filePath: string;
}

export interface MemoryContext {
  indexContent: string | undefined;  // MEMORY.md
  entries: MemoryEntry[];
}

export async function loadMemoryContext(memoryDir: string): Promise<MemoryContext> {
  const indexContent = await tryReadFile(path.join(memoryDir, 'MEMORY.md'));

  let files: string[] = [];
  try {
    files = await readdir(memoryDir);
  } catch {
    return {indexContent: undefined, entries: []};
  }

  const entries: MemoryEntry[] = [];
  for (const file of files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md')) {
    const filePath = path.join(memoryDir, file);
    const content = await tryReadFile(filePath);
    if (!content) continue;

    const type = inferMemoryType(file, content);
    const name = file.replace(/\.md$/, '');
    entries.push({name, type, content, filePath});
  }

  return {indexContent, entries};
}

export function formatMemoryContextSection(ctx: MemoryContext): string | undefined {
  const parts: string[] = [];

  if (ctx.indexContent?.trim()) {
    parts.push(ctx.indexContent.trim());
  }

  for (const entry of ctx.entries) {
    parts.push(`## ${entry.name} (${entry.type})\n${entry.content.trim()}`);
  }

  return parts.length > 0 ? `# Memory\n\n${parts.join('\n\n')}` : undefined;
}

const DEFAULT_CACHE_TTL_MS = 60_000;

export function createMemoryContextProvider(memoryDir: string, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
  let cached: string | undefined | null = null;
  let cachedAt = 0;
  return async (): Promise<string | undefined> => {
    const now = Date.now();
    if (cached !== null && (now - cachedAt) < cacheTtlMs) return cached;
    const ctx = await loadMemoryContext(memoryDir);
    cached = formatMemoryContextSection(ctx);
    cachedAt = now;
    return cached;
  };
}

function inferMemoryType(fileName: string, content: string): MemoryEntry['type'] {
  // Check frontmatter type field
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('\n---', 3);
    if (endIdx !== -1) {
      const frontmatter = content.slice(4, endIdx);
      const typeMatch = frontmatter.match(/^type:\s*(\w+)/m);
      if (typeMatch) {
        const t = typeMatch[1].toLowerCase();
        if (['user', 'feedback', 'project', 'reference'].includes(t)) return t as MemoryEntry['type'];
      }
    }
  }

  // Fallback: infer from filename prefix
  if (fileName.startsWith('user')) return 'user';
  if (fileName.startsWith('feedback')) return 'feedback';
  if (fileName.startsWith('project')) return 'project';
  if (fileName.startsWith('reference')) return 'reference';
  return 'unknown';
}

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

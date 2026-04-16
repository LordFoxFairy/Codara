import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import type {MemoryFile, MemoryType} from './types';

export interface MemoryHeader {
  name: string;
  fileName: string;
  description: string;
  type: MemoryType | undefined;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

export class MemoryReader {
  constructor(private readonly memoryDir: string) {}

  async list(): Promise<MemoryHeader[]> {
    let entries: string[];
    try {
      entries = await readdir(this.memoryDir);
    } catch {
      return [];
    }

    const mdFiles = entries.filter(
      (f) => f.endsWith('.md') && f !== 'MEMORY.md',
    );

    const headers: MemoryHeader[] = [];
    for (const fileName of mdFiles) {
      const filePath = path.join(this.memoryDir, fileName);
      try {
        const content = await readFile(filePath, 'utf8');
        const meta = parseFrontmatter(content);
        headers.push({
          name: meta.name || fileName.replace(/\.md$/, ''),
          fileName,
          description: meta.description || '',
          type: parseMemoryType(meta.type),
        });
      } catch { /* skip unreadable files */ }
    }

    return headers;
  }

  async read(name: string): Promise<MemoryFile | undefined> {
    const fileName = sanitizeFileName(name) + '.md';
    const filePath = path.join(this.memoryDir, fileName);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      return undefined;
    }

    const meta = parseFrontmatter(raw);
    const body = raw.replace(FRONTMATTER_REGEX, '').trim();

    return {
      name: meta.name || name,
      description: meta.description || '',
      type: parseMemoryType(meta.type) ?? 'reference',
      content: body,
    };
  }

  async search(query: string): Promise<MemoryHeader[]> {
    const all = await this.list();
    if (!query.trim()) return all;

    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: MemoryHeader[] = [];

    for (const header of all) {
      const headerText = `${header.name} ${header.description}`.toLowerCase();
      if (keywords.some((kw) => headerText.includes(kw))) {
        results.push(header);
        continue;
      }

      // Also search file content
      const filePath = path.join(this.memoryDir, header.fileName);
      try {
        const content = (await readFile(filePath, 'utf8')).toLowerCase();
        if (keywords.some((kw) => content.includes(kw))) {
          results.push(header);
        }
      } catch { /* skip */ }
    }

    return results;
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

function parseMemoryType(value: string | undefined): MemoryType | undefined {
  if (!value) return undefined;
  const valid: MemoryType[] = ['user', 'feedback', 'project', 'reference'];
  return valid.includes(value as MemoryType) ? (value as MemoryType) : undefined;
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

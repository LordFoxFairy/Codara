import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {MemoryFile, MemoryType} from './types';

export class MemoryWriter {
  constructor(private readonly memoryDir: string) {}

  async write(memory: MemoryFile): Promise<string> {
    await mkdir(this.memoryDir, {recursive: true});
    const fileName = sanitizeFileName(memory.name) + '.md';
    const filePath = path.join(this.memoryDir, fileName);
    const content = formatMemoryFile(memory);
    await writeFile(filePath, content, 'utf8');
    await this.updateIndex(memory.name, fileName, memory.description);
    return filePath;
  }

  async remove(name: string): Promise<void> {
    const fileName = sanitizeFileName(name) + '.md';
    const filePath = path.join(this.memoryDir, fileName);
    try {
      const {unlink} = await import('node:fs/promises');
      await unlink(filePath);
    } catch { /* file may not exist */ }
    await this.removeFromIndex(name);
  }

  private async updateIndex(name: string, fileName: string, description: string): Promise<void> {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    let content = '';
    try {
      content = await readFile(indexPath, 'utf8');
    } catch { /* doesn't exist yet */ }

    const entry = `- [${name}](${fileName}) — ${description}`;
    // Check if entry already exists (by name)
    const lines = content.split('\n');
    const existingIdx = lines.findIndex(l => l.includes(`[${name}]`));
    if (existingIdx >= 0) {
      lines[existingIdx] = entry;
    } else {
      lines.push(entry);
    }

    await writeFile(indexPath, lines.filter(l => l.trim() || lines.indexOf(l) === 0).join('\n') + '\n', 'utf8');
  }

  private async removeFromIndex(name: string): Promise<void> {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      const content = await readFile(indexPath, 'utf8');
      const filtered = content.split('\n').filter(l => !l.includes(`[${name}]`)).join('\n');
      await writeFile(indexPath, filtered + '\n', 'utf8');
    } catch { /* index may not exist */ }
  }
}

function formatMemoryFile(memory: MemoryFile): string {
  return [
    '---',
    `name: ${memory.name}`,
    `description: ${memory.description}`,
    `type: ${memory.type}`,
    '---',
    '',
    memory.content,
    '',
  ].join('\n');
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

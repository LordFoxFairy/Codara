import {describe, expect, it} from 'bun:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MemoryWriter} from '../../../src/memory/writer';

describe('MemoryWriter', () => {
  it('should write memory file with frontmatter', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const filePath = await writer.write({
        name: 'user_role', description: 'User is a senior engineer',
        type: 'user', content: 'The user is a senior backend engineer.',
      });
      const content = await readFile(filePath, 'utf8');
      expect(content).toContain('---');
      expect(content).toContain('name: user_role');
      expect(content).toContain('type: user');
      expect(content).toContain('senior backend engineer');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should update MEMORY.md index', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      await writer.write({name: 'user_role', description: 'Role info', type: 'user', content: 'test'});
      const index = await readFile(path.join(dir, 'MEMORY.md'), 'utf8');
      expect(index).toContain('[user_role]');
      expect(index).toContain('Role info');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should remove memory and update index', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      await writer.write({name: 'temp', description: 'Temp', type: 'project', content: 'data'});
      await writer.remove('temp');
      const index = await readFile(path.join(dir, 'MEMORY.md'), 'utf8');
      expect(index).not.toContain('[temp]');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});

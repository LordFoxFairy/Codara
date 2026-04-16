import {describe, expect, it} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MemoryWriter} from '../../../src/capability/memory/writer';
import {MemoryReader} from '../../../src/capability/memory/reader';

describe('MemoryReader', () => {
  it('should list all memory files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const reader = new MemoryReader(dir);

      await writer.write({name: 'user_role', description: 'Role info', type: 'user', content: 'Senior engineer'});
      await writer.write({name: 'project_arch', description: 'Architecture', type: 'project', content: 'Monorepo'});

      const headers = await reader.list();
      expect(headers.length).toBe(2);
      const names = headers.map((h) => h.name);
      expect(names).toContain('user_role');
      expect(names).toContain('project_arch');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should return empty list when directory does not exist', async () => {
    const reader = new MemoryReader('/tmp/nonexistent-memory-dir-' + Date.now());
    const headers = await reader.list();
    expect(headers).toEqual([]);
  });

  it('should read a specific memory by name', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const reader = new MemoryReader(dir);

      await writer.write({name: 'test_memory', description: 'Test desc', type: 'feedback', content: 'Important feedback content'});

      const memory = await reader.read('test_memory');
      expect(memory).toBeDefined();
      expect(memory!.name).toBe('test_memory');
      expect(memory!.description).toBe('Test desc');
      expect(memory!.type).toBe('feedback');
      expect(memory!.content).toContain('Important feedback content');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should return undefined for non-existent memory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const reader = new MemoryReader(dir);
      const memory = await reader.read('does_not_exist');
      expect(memory).toBeUndefined();
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should search memories by keyword in name/description', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const reader = new MemoryReader(dir);

      await writer.write({name: 'user_role', description: 'User is a senior engineer', type: 'user', content: 'Details about role'});
      await writer.write({name: 'project_arch', description: 'Architecture decisions', type: 'project', content: 'Monorepo layout'});
      await writer.write({name: 'git_rules', description: 'Git conventions', type: 'reference', content: 'Branch naming rules'});

      const results = await reader.search('engineer');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('user_role');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should search memories by keyword in content', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const reader = new MemoryReader(dir);

      await writer.write({name: 'project_arch', description: 'Architecture', type: 'project', content: 'Uses monorepo with turborepo'});
      await writer.write({name: 'git_rules', description: 'Git conventions', type: 'reference', content: 'Branch naming'});

      const results = await reader.search('turborepo');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('project_arch');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('should return all memories when search query is empty', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codara-memory-'));
    try {
      const writer = new MemoryWriter(dir);
      const reader = new MemoryReader(dir);

      await writer.write({name: 'a', description: 'First', type: 'user', content: 'one'});
      await writer.write({name: 'b', description: 'Second', type: 'project', content: 'two'});

      const results = await reader.search('');
      expect(results.length).toBe(2);
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});

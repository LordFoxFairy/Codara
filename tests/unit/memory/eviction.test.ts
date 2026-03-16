import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {mkdir, writeFile, readdir, stat} from 'node:fs/promises';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {evictMemoryFiles, type EvictionPolicy} from '@infra/context/memory/eviction';

let tmpDir: string;

function topicPath(name: string): string {
  return path.join(tmpDir, name);
}

async function createTopicFile(name: string, content: string, mtimeOffset: number): Promise<void> {
  const filePath = topicPath(name);
  await writeFile(filePath, content, 'utf8');
  // Set mtime to a past time based on offset (higher = older)
  const mtime = new Date(Date.now() - mtimeOffset * 1000);
  const {utimes} = await import('node:fs/promises');
  await utimes(filePath, mtime, mtime);
}

async function listTopics(): Promise<string[]> {
  return (await readdir(tmpDir)).filter((n) => n.endsWith('.md')).sort();
}

describe('evictMemoryFiles', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codara-evict-'));
  });

  afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true});
  });

  test('evicts by count — keeps newest, removes oldest', async () => {
    await createTopicFile('old.md', 'x', 300);
    await createTopicFile('mid.md', 'x', 200);
    await createTopicFile('new.md', 'x', 100);

    const policy: EvictionPolicy = {maxFiles: 2, maxTotalBytes: Infinity};
    const evicted = await evictMemoryFiles(tmpDir, policy);

    expect(evicted).toBe(1);
    const remaining = await listTopics();
    expect(remaining).toEqual(['mid.md', 'new.md']);
  });

  test('evicts oldest first when over total size', async () => {
    const bigContent = 'x'.repeat(1000);
    await createTopicFile('old.md', bigContent, 300);
    await createTopicFile('new.md', bigContent, 100);

    // maxTotalBytes smaller than both files combined
    const policy: EvictionPolicy = {maxFiles: 100, maxTotalBytes: 1500};
    const evicted = await evictMemoryFiles(tmpDir, policy);

    expect(evicted).toBe(1);
    const remaining = await listTopics();
    expect(remaining).toEqual(['new.md']);
  });

  test('no eviction when under limits', async () => {
    await createTopicFile('a.md', 'hello', 100);
    await createTopicFile('b.md', 'world', 200);

    const policy: EvictionPolicy = {maxFiles: 10, maxTotalBytes: 100_000};
    const evicted = await evictMemoryFiles(tmpDir, policy);

    expect(evicted).toBe(0);
    const remaining = await listTopics();
    expect(remaining).toEqual(['a.md', 'b.md']);
  });

  test('excludes MEMORY.md from eviction', async () => {
    await writeFile(path.join(tmpDir, 'MEMORY.md'), 'index', 'utf8');
    await createTopicFile('old.md', 'x', 300);

    const policy: EvictionPolicy = {maxFiles: 1, maxTotalBytes: Infinity};
    const evicted = await evictMemoryFiles(tmpDir, policy);

    expect(evicted).toBe(0);
    const remaining = await listTopics();
    expect(remaining).toContain('MEMORY.md');
    expect(remaining).toContain('old.md');
  });
});

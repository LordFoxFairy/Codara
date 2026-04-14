import {describe, expect, it} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadMemoryContext, formatMemoryContextSection} from '@context/memory-context';

describe('loadMemoryContext', () => {
  it('should return empty for non-existent dir', async () => {
    const ctx = await loadMemoryContext('/tmp/codara-nonexistent-memory-dir');
    expect(ctx.indexContent).toBeUndefined();
    expect(ctx.entries).toEqual([]);
  });

  it('should load MEMORY.md index', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-mem-'));
    try {
      await writeFile(path.join(root, 'MEMORY.md'), '# Memory Index\n- [User](user_role.md)');
      const ctx = await loadMemoryContext(root);
      expect(ctx.indexContent).toContain('Memory Index');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load memory entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-mem-'));
    try {
      await writeFile(path.join(root, 'user_role.md'), '---\ntype: user\n---\nSenior engineer');
      await writeFile(path.join(root, 'feedback_tdd.md'), '---\ntype: feedback\n---\nAlways use TDD');
      const ctx = await loadMemoryContext(root);
      expect(ctx.entries).toHaveLength(2);
      expect(ctx.entries.find(e => e.type === 'user')).toBeDefined();
      expect(ctx.entries.find(e => e.type === 'feedback')).toBeDefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should infer type from filename when no frontmatter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-mem-'));
    try {
      await writeFile(path.join(root, 'project_goal.md'), 'Ship v2.0');
      const ctx = await loadMemoryContext(root);
      expect(ctx.entries[0].type).toBe('project');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});

describe('formatMemoryContextSection', () => {
  it('should format context with index and entries', () => {
    const section = formatMemoryContextSection({
      indexContent: '# Index',
      entries: [{name: 'user_role', type: 'user', content: 'Engineer', filePath: '/tmp/test.md'}],
    });
    expect(section).toContain('# Memory');
    expect(section).toContain('# Index');
    expect(section).toContain('user_role (user)');
  });

  it('should return undefined for empty context', () => {
    expect(formatMemoryContextSection({indexContent: undefined, entries: []})).toBeUndefined();
  });
});

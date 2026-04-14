import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCodaraMd} from '@config/codara-md';

describe('loadCodaraMd', () => {
  it('should return empty when no CODARA.md exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions).toEqual([]);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load project CODARA.md', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    try {
      await mkdir(userHome, {recursive: true});
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await writeFile(path.join(projectRoot, '.codara', 'CODARA.md'), '# Instructions\n\nAlways use TDD.\n');
      const result = await loadCodaraMd({projectRoot, userHome});
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].source).toBe('project');
      expect(result.instructions[0].content).toContain('Always use TDD');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load user CODARA.md with lower priority', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    try {
      await mkdir(path.join(userHome, '.codara'), {recursive: true});
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await writeFile(path.join(userHome, '.codara', 'CODARA.md'), 'Global instructions.\n');
      await writeFile(path.join(projectRoot, '.codara', 'CODARA.md'), 'Project instructions.\n');
      const result = await loadCodaraMd({projectRoot, userHome});
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions[0].source).toBe('user');
      expect(result.instructions[1].source).toBe('project');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load CODARA.local.md', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await writeFile(path.join(root, 'CODARA.local.md'), 'Local override.\n');
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions.some(i => i.source === 'local')).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should resolve @include directives', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await mkdir(path.join(root, '.codara'), {recursive: true});
      await writeFile(path.join(root, '.codara', 'CODARA.md'), '# Main\n\n@./extra.md\n\nEnd of main.\n');
      await writeFile(path.join(root, '.codara', 'extra.md'), 'Included content from extra.\n');
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions[0].content).toContain('Included content from extra');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should parse YAML frontmatter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await mkdir(path.join(root, '.codara'), {recursive: true});
      await writeFile(path.join(root, '.codara', 'CODARA.md'), [
        '---', 'description: project guidelines', '---', '', '# Guidelines', '', 'Be concise.',
      ].join('\n'));
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions[0].frontmatter?.description).toBe('project guidelines');
      expect(result.instructions[0].content).toContain('Be concise');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});

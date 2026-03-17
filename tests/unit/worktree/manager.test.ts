import {describe, expect, it} from 'bun:test';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mkdtempSync} from 'node:fs';
import {isGitRepo, createWorktree, removeWorktree, hasWorktreeChanges} from '@engine/worktree/manager';

describe('worktree/manager', () => {
  describe('isGitRepo', () => {
    it('对 git 仓库返回 true', () => {
      // 当前项目本身就是 git repo
      const projectRoot = path.resolve(__dirname, '../../..');
      expect(isGitRepo(projectRoot)).toBe(true);
    });

    it('对非 git 目录返回 false', () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'worktree-test-'));
      expect(isGitRepo(tempDir)).toBe(false);
    });

    it('对不存在的路径返回 false', () => {
      expect(isGitRepo('/nonexistent/path/that/does/not/exist')).toBe(false);
    });
  });

  describe('createWorktree', () => {
    it('导出为函数', () => {
      expect(typeof createWorktree).toBe('function');
    });
  });

  describe('removeWorktree', () => {
    it('导出为函数', () => {
      expect(typeof removeWorktree).toBe('function');
    });
  });

  describe('hasWorktreeChanges', () => {
    it('导出为函数', () => {
      expect(typeof hasWorktreeChanges).toBe('function');
    });
  });
});

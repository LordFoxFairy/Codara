import {describe, expect, it} from 'bun:test';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {
  type CodaraMode,
  PLAN_MODE_BLOCKED_TOOLS,
  filterToolsForPlanMode,
  isModeWriteAllowed,
} from '@engine/modes/plan-mode';

function stubTool(name: string) {
  return tool(async () => 'ok', {name, description: name, schema: z.object({})});
}

describe('plan-mode', () => {
  describe('CodaraMode type', () => {
    it('接受 normal / plan / auto 三个值', () => {
      const modes: CodaraMode[] = ['normal', 'plan', 'auto'];
      expect(modes).toHaveLength(3);
    });
  });

  describe('PLAN_MODE_BLOCKED_TOOLS', () => {
    it('包含 write_file 和 edit_file', () => {
      expect(PLAN_MODE_BLOCKED_TOOLS.has('write_file')).toBe(true);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('edit_file')).toBe(true);
    });

    it('不包含只读工具', () => {
      expect(PLAN_MODE_BLOCKED_TOOLS.has('read_file')).toBe(false);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('glob')).toBe(false);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('grep')).toBe(false);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('bash')).toBe(false);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('fetch_url')).toBe(false);
      expect(PLAN_MODE_BLOCKED_TOOLS.has('web_search')).toBe(false);
    });
  });

  describe('filterToolsForPlanMode', () => {
    it('移除 write_file 和 edit_file，保留其他工具', () => {
      const tools = [
        stubTool('bash'),
        stubTool('read_file'),
        stubTool('write_file'),
        stubTool('edit_file'),
        stubTool('glob'),
        stubTool('grep'),
        stubTool('fetch_url'),
        stubTool('web_search'),
      ];

      const filtered = filterToolsForPlanMode(tools);
      const names = filtered.map((t) => t.name);

      expect(names).toEqual(['bash', 'read_file', 'glob', 'grep', 'fetch_url', 'web_search']);
    });

    it('空数组输入返回空数组', () => {
      expect(filterToolsForPlanMode([])).toEqual([]);
    });

    it('没有被阻止工具时原样返回', () => {
      const tools = [stubTool('bash'), stubTool('read_file')];
      const filtered = filterToolsForPlanMode(tools);
      expect(filtered.map((t) => t.name)).toEqual(['bash', 'read_file']);
    });
  });

  describe('isModeWriteAllowed', () => {
    it('normal 模式允许写操作', () => {
      expect(isModeWriteAllowed('normal')).toBe(true);
    });

    it('auto 模式允许写操作', () => {
      expect(isModeWriteAllowed('auto')).toBe(true);
    });

    it('plan 模式禁止写操作', () => {
      expect(isModeWriteAllowed('plan')).toBe(false);
    });
  });
});

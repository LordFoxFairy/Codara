import {describe, expect, it} from 'bun:test';
import {formatToolHeaderArgs, TOOL_NAMES} from '@/shared/tool-display';

describe('tool display formatting', () => {
  it('summarizes long Agent prompts into a single concise header line', () => {
    const args = [
      '只读分析 `src/cli` 目录的架构：',
      '',
      '**目标**：',
      '1. 列出目录结构',
      '2. 识别核心职责',
    ].join('\n');

    const formatted = formatToolHeaderArgs(TOOL_NAMES.AGENT, args);

    expect(formatted).toBe('只读分析 `src/cli` 目录的架构：');
    expect(formatted).not.toContain('\n');
    expect(formatted).not.toContain('**目标**');
  });

  it('keeps file tool headers simplified to basenames', () => {
    expect(formatToolHeaderArgs(TOOL_NAMES.READ_FILE, '/tmp/project/README.md')).toBe('README.md');
  });
});

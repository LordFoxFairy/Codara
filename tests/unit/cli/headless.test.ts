import {describe, expect, it} from 'bun:test';
import {parseCliArgs} from '@cli/cli-args';

describe('parseCliArgs', () => {
  describe('既有行为', () => {
    it('解析裸文本为 initialPrompt', () => {
      const result = parseCliArgs(['hello', 'world']);
      expect(result.initialPrompt).toBe('hello world');
    });

    it('--resume / -r 解析 sessionId', () => {
      expect(parseCliArgs(['--resume', 'abc']).resumeSessionId).toBe('abc');
      expect(parseCliArgs(['-r', 'abc']).resumeSessionId).toBe('abc');
      expect(parseCliArgs(['--resume=def']).resumeSessionId).toBe('def');
    });
  });

  describe('-p / --prompt 标志（headless 模式）', () => {
    it('-p "prompt" 设置 headlessPrompt', () => {
      const result = parseCliArgs(['-p', 'fix the bug']);
      expect(result.headlessPrompt).toBe('fix the bug');
    });

    it('--prompt "prompt" 设置 headlessPrompt', () => {
      const result = parseCliArgs(['--prompt', 'fix the bug']);
      expect(result.headlessPrompt).toBe('fix the bug');
    });

    it('--prompt=value 形式', () => {
      const result = parseCliArgs(['--prompt=deploy now']);
      expect(result.headlessPrompt).toBe('deploy now');
    });
  });

  describe('--json 标志', () => {
    it('默认 outputFormat 为 undefined', () => {
      const result = parseCliArgs([]);
      expect(result.outputFormat).toBeUndefined();
    });

    it('--json 设置 outputFormat 为 json', () => {
      const result = parseCliArgs(['--json']);
      expect(result.outputFormat).toBe('json');
    });
  });

  describe('-c / --continue 标志', () => {
    it('-c 设置 continueLatest 为 true', () => {
      expect(parseCliArgs(['-c']).continueLatest).toBe(true);
    });

    it('--continue 设置 continueLatest 为 true', () => {
      expect(parseCliArgs(['--continue']).continueLatest).toBe(true);
    });

    it('默认为 false', () => {
      expect(parseCliArgs([]).continueLatest).toBe(false);
    });
  });

  describe('--fork-session 标志', () => {
    it('设置 forkSession 为 true', () => {
      expect(parseCliArgs(['--fork-session']).forkSession).toBe(true);
    });

    it('默认为 false', () => {
      expect(parseCliArgs([]).forkSession).toBe(false);
    });
  });

  describe('--dangerously-skip-permissions 标志', () => {
    it('设置 dangerouslySkipPermissions 为 true', () => {
      expect(parseCliArgs(['--dangerously-skip-permissions']).dangerouslySkipPermissions).toBe(true);
    });

    it('默认为 false', () => {
      expect(parseCliArgs([]).dangerouslySkipPermissions).toBe(false);
    });
  });

  describe('复合参数', () => {
    it('-p + --json + -c 同时使用', () => {
      const result = parseCliArgs(['-p', 'deploy', '--json', '-c']);
      expect(result.headlessPrompt).toBe('deploy');
      expect(result.outputFormat).toBe('json');
      expect(result.continueLatest).toBe(true);
    });
  });
});

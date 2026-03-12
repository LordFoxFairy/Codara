import {describe, expect, test} from 'bun:test';
import {resolveCliLayoutMode} from '@/cli/app/layout-mode';

describe('cli layout mode', () => {
  test('should use wide mode for broad terminals', () => {
    expect(resolveCliLayoutMode(100)).toBe('wide');
  });

  test('should use compact mode for medium terminals', () => {
    expect(resolveCliLayoutMode(70)).toBe('compact');
  });

  test('should use minimal mode for narrow terminals', () => {
    expect(resolveCliLayoutMode(50)).toBe('minimal');
  });
});

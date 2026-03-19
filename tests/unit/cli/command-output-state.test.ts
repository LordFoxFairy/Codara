import {describe, expect, it} from 'bun:test';
import {
  COMMAND_OUTPUT_WINDOW_SIZE,
  createCliCommandOutput,
  scrollCliCommandOutput,
} from '@/cli/hooks/use-command-output-state';

describe('CLI command output state', () => {
  it('starts every new command output at offset 0', () => {
    expect(createCliCommandOutput('line-1\nline-2', 'status')).toEqual({
      content: 'line-1\nline-2',
      commandName: 'status',
      scrollOffset: 0,
    });
  });

  it('keeps the same object when scrolling has no effect', () => {
    const current = createCliCommandOutput('line-1\nline-2', 'status');
    expect(scrollCliCommandOutput(current, 1)).toBe(current);
  });

  it('clamps scrolling inside the visible command-output window', () => {
    const content = Array.from({length: COMMAND_OUTPUT_WINDOW_SIZE + 5}, (_, index) => `line-${index + 1}`).join('\n');
    const current = createCliCommandOutput(content, 'status');
    const next = scrollCliCommandOutput(current, 3);
    const clamped = scrollCliCommandOutput(next, 999);

    expect(next?.scrollOffset).toBe(3);
    expect(clamped?.scrollOffset).toBe(5);
  });
});

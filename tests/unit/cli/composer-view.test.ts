import {describe, expect, test} from 'bun:test';
import {buildComposerViewport} from '@/cli/components/prompt/composer-view';
import {createComposerState} from '@/cli/composer/state';

describe('cli composer viewport', () => {
  test('empty composer should keep placeholder line visible', () => {
    const viewport = buildComposerViewport(createComposerState());

    expect(viewport.lines).toEqual([
      {
        beforeCursor: '',
        afterCursor: '',
        placeholder: 'Try "fix lint errors"',
        isCursorLine: true,
      },
    ]);
    expect(viewport.hasOverflowAbove).toBe(false);
    expect(viewport.hasOverflowBelow).toBe(false);
  });

  test('whitespace-only composer should still show the placeholder line', () => {
    const viewport = buildComposerViewport(createComposerState('   \n', 4), undefined, 'Reply to Codara...');

    expect(viewport.lines).toEqual([
      {
        beforeCursor: '',
        afterCursor: '',
        placeholder: 'Reply to Codara...',
        isCursorLine: true,
      },
    ]);
  });

  test('viewport should keep cursor line visible in the middle block when possible', () => {
    const state = createComposerState('l1\nl2\nl3\nl4\nl5\nl6', 11);
    const viewport = buildComposerViewport(state, 4);

    expect(viewport.lines.map(line => `${line.beforeCursor}|${line.afterCursor}|${line.isCursorLine ? 'cursor' : 'plain'}`)).toEqual([
      'l2||plain',
      'l3||plain',
      'l4||cursor',
      '|l5|plain',
    ]);
    expect(viewport.hasOverflowAbove).toBe(true);
    expect(viewport.hasOverflowBelow).toBe(true);
  });

  test('viewport should stay pinned to the top when cursor is near the start', () => {
    const state = createComposerState('l1\nl2\nl3\nl4\nl5', 1);
    const viewport = buildComposerViewport(state, 3);

    expect(viewport.lines.map(line => `${line.beforeCursor}|${line.afterCursor}|${line.isCursorLine ? 'cursor' : 'plain'}`)).toEqual([
      'l|1|cursor',
      '|l2|plain',
      '|l3|plain',
    ]);
    expect(viewport.hasOverflowAbove).toBe(false);
    expect(viewport.hasOverflowBelow).toBe(true);
  });

  test('cursor line should move to the new line after newline insertion', () => {
    const state = createComposerState('line1\nline2', 7);
    const viewport = buildComposerViewport(state, 3);

    expect(viewport.lines.map(line => line.isCursorLine)).toEqual([false, true]);
  });

  test('viewport should wrap CJK text by display width instead of raw string length', () => {
    const state = createComposerState('你好世界再见', 6);
    const viewport = buildComposerViewport(state, 6, undefined, 10);

    expect(viewport.lines.map(line => `${line.beforeCursor}|${line.afterCursor}|${line.isCursorLine ? 'cursor' : 'plain'}`)).toEqual([
      '你好世界||plain',
      '再见||cursor',
    ]);
  });

  test('viewport should keep pasted mixed-language lines intact across wraps', () => {
    const state = createComposerState('你现在是需求收集助手。不要直接分析项目。', 20);
    const viewport = buildComposerViewport(state, 6, undefined, 18);

    expect(viewport.lines.length).toBeGreaterThan(1);
    expect(viewport.lines.some((line) => line.beforeCursor.includes('需求'))).toBe(true);
    expect(viewport.lines.some((line) => `${line.beforeCursor}${line.afterCursor}`.includes('分析项目'))).toBe(true);
  });

  test('default viewport should keep ordinary multi-line pasted prompts visible without truncating to six lines', () => {
    const state = createComposerState('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8', 23);
    const viewport = buildComposerViewport(state);

    expect(viewport.lines.map((line) => `${line.beforeCursor}${line.afterCursor}`)).toEqual([
      'l1',
      'l2',
      'l3',
      'l4',
      'l5',
      'l6',
      'l7',
      'l8',
    ]);
    expect(viewport.hasOverflowAbove).toBe(false);
    expect(viewport.hasOverflowBelow).toBe(false);
  });
});

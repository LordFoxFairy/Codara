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
        placeholder: 'Type a request',
        isCursorLine: true,
      },
    ]);
    expect(viewport.hasOverflowAbove).toBe(false);
    expect(viewport.hasOverflowBelow).toBe(false);
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
});

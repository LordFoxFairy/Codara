import {describe, expect, test} from 'bun:test';
import {
  backspaceComposerText,
  createComposerState,
  insertComposerNewline,
  insertComposerText,
  isComposerCursorOnFirstLine,
  isComposerCursorOnLastLine,
  isComposerCursorOnFirstVisualLine,
  isComposerCursorOnLastVisualLine,
  moveComposerCursorDown,
  moveComposerCursorDownWithPreference,
  moveComposerCursorEnd,
  moveComposerCursorHome,
  moveComposerCursorLeft,
  moveComposerCursorRight,
  moveComposerCursorUp,
  moveComposerCursorUpWithPreference,
  replaceComposerText,
} from '@/cli/composer/state';

describe('cli composer state', () => {
  test('insertComposerText should insert at cursor position', () => {
    const state = createComposerState('helo', 2);
    expect(insertComposerText(state, 'l')).toEqual({text: 'hello', cursorOffset: 3});
  });

  test('composer state should normalize CRLF input while preserving cursor position', () => {
    expect(createComposerState('ab\r\ncd', 4)).toEqual({text: 'ab\ncd', cursorOffset: 3});
    expect(replaceComposerText('ab\r\ncd')).toEqual({text: 'ab\ncd', cursorOffset: 5});
    expect(insertComposerText(createComposerState('ab'), '\r\ncd')).toEqual({text: 'ab\ncd', cursorOffset: 5});
  });

  test('insertComposerNewline should create multi-line content', () => {
    const state = createComposerState('hello', 5);
    expect(insertComposerNewline(state)).toEqual({text: 'hello\n', cursorOffset: 6});
  });

  test('backspaceComposerText should remove before cursor', () => {
    const state = createComposerState('hello', 5);
    expect(backspaceComposerText(state)).toEqual({text: 'hell', cursorOffset: 4});
  });

  test('cursor movement should clamp within text bounds', () => {
    expect(moveComposerCursorLeft(createComposerState('abc', 0)).cursorOffset).toBe(0);
    expect(moveComposerCursorRight(createComposerState('abc', 3)).cursorOffset).toBe(3);
  });

  test('home and end should move within current line', () => {
    const state = createComposerState('ab\ncd\nef', 4);
    expect(moveComposerCursorHome(state).cursorOffset).toBe(3);
    expect(moveComposerCursorEnd(state).cursorOffset).toBe(5);
  });

  test('up and down should preserve the column when possible', () => {
    const upState = createComposerState('abc\nxy\n12345', 9);
    expect(moveComposerCursorUp(upState).cursorOffset).toBe(6);

    const downState = createComposerState('abc\nxy\n12345', 5);
    expect(moveComposerCursorDown(downState).cursorOffset).toBe(8);
  });

  test('up and down should clamp to target line length', () => {
    const upState = createComposerState('12345\nxy', 7);
    expect(moveComposerCursorUp(upState).cursorOffset).toBe(1);

    const downState = createComposerState('xy\n12345', 2);
    expect(moveComposerCursorDown(downState).cursorOffset).toBe(5);
  });

  test('cursor movement should treat CRLF-pasted content as normal LF lines', () => {
    const state = createComposerState('ab\r\ncd\r\nef', 1);
    expect(moveComposerCursorDown(state).cursorOffset).toBe(4);
  });

  test('should tell whether the cursor is on the first or last line', () => {
    expect(isComposerCursorOnFirstLine(createComposerState('one\ntwo', 1))).toBe(true);
    expect(isComposerCursorOnFirstLine(createComposerState('one\ntwo', 5))).toBe(false);

    expect(isComposerCursorOnLastLine(createComposerState('one\ntwo', 1))).toBe(false);
    expect(isComposerCursorOnLastLine(createComposerState('one\ntwo', 5))).toBe(true);
  });

  test('up and down should move across wrapped visual lines within one logical line', () => {
    const upState = createComposerState('abcdefghijklmnop', 16);
    expect(moveComposerCursorUp(upState, 10).cursorOffset).toBe(10);

    const downState = createComposerState('abcdefghijklmnop', 6);
    expect(moveComposerCursorDown(downState, 10).cursorOffset).toBe(12);
  });

  test('home and end should stay within the current wrapped visual line', () => {
    const state = createComposerState('abcdefghijklmnop', 10);
    expect(moveComposerCursorHome(state, 10).cursorOffset).toBe(6);
    expect(moveComposerCursorEnd(state, 10).cursorOffset).toBe(12);
  });

  test('should tell whether the cursor is on the first or last visual line', () => {
    expect(isComposerCursorOnFirstVisualLine(createComposerState('abcdefghijklmnop', 1), 10)).toBe(true);
    expect(isComposerCursorOnFirstVisualLine(createComposerState('abcdefghijklmnop', 8), 10)).toBe(false);

    expect(isComposerCursorOnLastVisualLine(createComposerState('abcdefghijklmnop', 8), 10)).toBe(false);
    expect(isComposerCursorOnLastVisualLine(createComposerState('abcdefghijklmnop', 16), 10)).toBe(true);
  });

  test('vertical movement helpers should preserve the original preferred column across shorter lines', () => {
    const start = createComposerState('abcdef\nxy\n123456', 5);

    const downOnce = moveComposerCursorDownWithPreference(start);
    expect(downOnce.state.cursorOffset).toBe(9);
    expect(downOnce.preferredColumn).toBe(5);

    const downTwice = moveComposerCursorDownWithPreference(downOnce.state, undefined, downOnce.preferredColumn);
    expect(downTwice.state.cursorOffset).toBe(15);
    expect(downTwice.preferredColumn).toBe(5);

    const upOnce = moveComposerCursorUpWithPreference(downTwice.state, undefined, downTwice.preferredColumn);
    expect(upOnce.state.cursorOffset).toBe(9);

    const upTwice = moveComposerCursorUpWithPreference(upOnce.state, undefined, upOnce.preferredColumn);
    expect(upTwice.state.cursorOffset).toBe(5);
  });
});
